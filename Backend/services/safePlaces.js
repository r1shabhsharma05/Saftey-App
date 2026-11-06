// 🛡️ Safe-places service — the Overpass proxy lives here.
//
// The app used to query Overpass directly from the phone; on flaky mobile
// data those heavy queries timed out and Safe Hubs / Police Radar sat on
// an error. Server-side the same query runs from a fast network (Mumbai
// region), mirrors race with a bounded timeout, and results are cached
// per ~100m grid cell for 5 minutes — the phone gets one small, fast JSON
// response instead. The response keeps Overpass's shape ({ elements: [...] })
// so the app's existing parser works unchanged.
//
// D13: two cache tiers — the in-memory grid cache, then the shared
// Upstash cache (services/redis.js, D2 primitive), so a second Vercel
// instance reuses the first instance's fetch instead of re-hitting
// Overpass. Upstash is best-effort and never fails a lookup: unconfigured
// or down, the flow degrades to memory → live exactly as before.
// Each returned element is annotated (never filtered by default) with
// distanceKm from the query point and openNow from its OSM
// opening_hours tag — the D15 scoring inputs. openNow is true / false /
// null (unknown: no tag, or hours this parser cannot read); a place is
// only ever dropped when the caller passes openNow: true AND the hours
// definitively say closed — unknown hours never hide a police station.
const axios = require("axios");
const { cacheGet, cacheSet, redisStatus } = require("./redis");

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_SEC = 300;
const safePlacesCache = new Map();

const upstashKey = (key) => `safe-places:${key}`;

// Minimal OSM opening_hours reader — deliberately NOT a full parser.
// Handles the shapes OSM data actually carries for these places: 24/7,
// day lists/ranges with one or more HH:MM-HH:MM ranges, "off", and
// overnight ranges (22:00-02:00, checked against yesterday too).
// Anything else returns null (unknown), never a guessed verdict.
// shortcut: full opening_hours spec (PH rules, seasonal, sunrise-sunset)
// is out of scope; unknown hours stay visible, upgrade if D15 scoring
// ever needs a closed verdict from an exotic rule.
const DAY_INDEX = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

const parseDays = (spec) => {
  const days = new Set();
  for (const part of spec.split(",")) {
    const token = part.trim();
    if (DAY_INDEX[token] !== undefined) {
      days.add(DAY_INDEX[token]);
      continue;
    }
    const m = /^([A-Z][a-z])-([A-Z][a-z])$/.exec(token);
    if (m && DAY_INDEX[m[1]] !== undefined && DAY_INDEX[m[2]] !== undefined) {
      let i = DAY_INDEX[m[1]];
      for (;;) {
        days.add(i);
        if (i === DAY_INDEX[m[2]]) break;
        i = (i + 1) % 7;
      }
    }
  }
  return days;
};

const parseMinutes = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins <= 1440 ? mins : null;
};

const inInterval = (t, start, end) =>
  end > start ? t >= start && t < end : t >= start || t < end;

const isOpenNow = (openingHours, now = new Date()) => {
  if (!openingHours || typeof openingHours !== "string") return null;
  const cleaned = openingHours.replace(/"[^"]*"/g, "").trim();
  if (cleaned === "24/7") return true;
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const prevDay = (day + 6) % 7;
  // A day can carry several rules ("Mo 09:00-12:00; Mo 13:00-18:00"):
  // open wins over closed across rules covering today, and an
  // overnight rule from yesterday covers the small hours today.
  let todayCovered = false;
  let todayOpen = false;
  let overnightOpen = false;
  for (const rawRule of cleaned.split(";")) {
    const rule = rawRule.trim();
    if (!rule) continue;
    if (rule === "24/7") return true;
    let days;
    let rest = rule;
    const m = /^([A-Za-z,-]+)\s+(.+)$/.exec(rule);
    if (m && (DAY_INDEX[m[1]] !== undefined || m[1].includes("-") || m[1].includes(","))) {
      days = parseDays(m[1]);
      rest = m[2].trim();
    } else if (/^\d/.test(rule)) {
      days = new Set([0, 1, 2, 3, 4, 5, 6]);
    } else {
      continue;
    }
    if (days.size === 0) continue;
    if (rest === "off") {
      if (days.has(day)) todayCovered = true;
      continue;
    }
    const ranges = [];
    let malformed = false;
    for (const token of rest.split(",")) {
      const [a, b] = token.trim().split("-");
      const start = parseMinutes(a);
      const end = parseMinutes(b);
      if (start === null || end === null) {
        malformed = true;
        break;
      }
      ranges.push([start, end]);
    }
    if (malformed || ranges.length === 0) continue;
    if (days.has(day)) {
      todayCovered = true;
      if (ranges.some(([s, e]) => inInterval(mins, s, e))) todayOpen = true;
    } else if (days.has(prevDay)) {
      if (ranges.some(([s, e]) => e <= s && mins < e)) overnightOpen = true;
    }
  }
  if (todayOpen || overnightOpen) return true;
  if (todayCovered) return false;
  return null;
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};

// Annotate a fresh copy of the cached raw data — the cache itself stays
// raw, so distance (exact query point, not grid cell) and openNow (now,
// not fetch time) are recomputed per request.
const annotate = (raw, lat, lng, now) => ({
  ...raw,
  elements: (raw.elements || []).map((el) => {
    const elLat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
    const elLng = el.lon !== undefined ? el.lon : el.center && el.center.lon;
    return {
      ...el,
      distanceKm:
        elLat !== undefined && elLng !== undefined
          ? Math.round(haversineKm(lat, lng, elLat, elLng) * 100) / 100
          : null,
      openNow: isOpenNow(el.tags && el.tags.opening_hours, now),
    };
  }),
});

const lookupSafePlaces = async (lat, lng, options = {}) => {
  const now = options.now || new Date();
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = safePlacesCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    const data = annotate(hit.data, lat, lng, now);
    return {
      data: options.openNow ? filterOpen(data) : data,
      cached: true,
      source: "memory",
    };
  }
  // Shared tier: a sibling Vercel instance may already hold this cell.
  const shared = await cacheGet(upstashKey(key));
  if (shared && Array.isArray(shared.elements)) {
    safePlacesCache.set(key, { ts: Date.now(), data: shared });
    const data = annotate(shared, lat, lng, now);
    return {
      data: options.openNow ? filterOpen(data) : data,
      cached: true,
      source: "upstash",
    };
  }
  const query =
    `[out:json][timeout:25];(nwr["amenity"="police"](around:20000,${lat},${lng});` +
    `nwr["amenity"~"hospital|clinic|mall|cafe|bank|pharmacy|university|college"](around:10000,${lat},${lng});` +
    `nwr["tourism"~"hostel|hotel"](around:10000,${lat},${lng});` +
    `nwr["shop"~"mall|supermarket|department_store"](around:10000,${lat},${lng}););out center 200;`;
  // Race both public mirrors in parallel and take the first good answer:
  // sequentially trying a slow mirror first burned the whole budget
  // (observed live 2026-10-23: kumi timing out after api.de failed ->
  // 502 for the user). Overpass also rejects requests with no UA.
  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];
  const fetchMirror = async (base) => {
    const resp = await axios.get(base, {
      params: { data: query },
      timeout: 20000,
      headers: {
        "User-Agent": "SafeLifeAI/1.0 (personal safety app)",
        Accept: "application/json",
      },
    });
    if (resp.data && Array.isArray(resp.data.elements)) return resp.data;
    throw new Error(`Unexpected Overpass response shape from ${base}`);
  };
  try {
    const data = await Promise.any(mirrors.map(fetchMirror));
    safePlacesCache.set(key, { ts: Date.now(), data });
    // Best-effort share: a failed write degrades to memory-only, and
    // cacheSet itself never throws — this await cannot fail the lookup.
    await cacheSet(upstashKey(key), data, CACHE_TTL_SEC);
    const annotated = annotate(data, lat, lng, now);
    return {
      data: options.openNow ? filterOpen(annotated) : annotated,
      cached: false,
      source: "live",
    };
  } catch (err) {
    const msgs =
      err && err.errors
        ? err.errors.map((e) => e && e.message).join(" | ")
        : err && err.message;
    console.log("❌ SAFE-PLACES ERROR:", msgs);
    // Every mirror failed. If this grid cell was ever fetched
    // successfully, serve the stale copy instead of an error — for a
    // safety lookup, slightly old station data beats none.
    if (hit) {
      const data = annotate(hit.data, lat, lng, now);
      return {
        data: options.openNow ? filterOpen(data) : data,
        cached: true,
        stale: true,
        source: "memory-stale",
      };
    }
    const staleErr = new Error("Safe places lookup failed");
    staleErr.status = 502;
    throw staleErr;
  }
};

// Drop only definitively-closed places; unknown hours stay visible.
function filterOpen(data) {
  return {
    ...data,
    elements: data.elements.filter((el) => el.openNow !== false),
  };
}

// Cache stats for /health — counts only, never location data.
const getCacheStats = () => ({
  entries: safePlacesCache.size,
  upstashConfigured: redisStatus().configured,
});

module.exports = { lookupSafePlaces, getCacheStats, isOpenNow, haversineKm };
