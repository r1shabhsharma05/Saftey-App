// 🛡️ Safe-places service — the Overpass proxy lives here.
//
// The app used to query Overpass directly from the phone; on flaky mobile
// data those heavy queries timed out and Safe Hubs / Police Radar sat on
// an error. Server-side the same query runs from a fast network (Mumbai
// region), mirrors race with a bounded timeout, and results are cached
// per ~100m grid cell for 5 minutes — the phone gets one small, fast JSON
// response instead. The response keeps Overpass's shape ({ elements: [...] })
// so the app's existing parser works unchanged.
const axios = require("axios");

const CACHE_TTL_MS = 5 * 60 * 1000;
const safePlacesCache = new Map();

const lookupSafePlaces = async (lat, lng) => {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = safePlacesCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { data: hit.data, cached: true };
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
    return { data, cached: false };
  } catch (err) {
    const msgs =
      err && err.errors
        ? err.errors.map((e) => e && e.message).join(" | ")
        : err && err.message;
    console.log("❌ SAFE-PLACES ERROR:", msgs);
    // Every mirror failed. If this grid cell was ever fetched
    // successfully, serve the stale copy instead of an error — for a
    // safety lookup, slightly old station data beats none.
    if (hit) return { data: hit.data, cached: true, stale: true };
    const staleErr = new Error("Safe places lookup failed");
    staleErr.status = 502;
    throw staleErr;
  }
};

// Cache stats for /health — counts only, never location data.
const getCacheStats = () => ({ entries: safePlacesCache.size });

module.exports = { lookupSafePlaces, getCacheStats };
