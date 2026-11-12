// 🛰️ Guardian GEO matching engine (SafeLife 2.0 Day 20, plan §6 D20,
// plan §3 F2).
//
// When someone needs help at a location, this finds the verified,
// available guardians near them, ranked best-first, so D21 can fan
// an alert out to them. D20 ships the candidate set — no alert is
// sent here.
//
// Ranking (plan: distance × rating × availability):
// - availability is a HARD FILTER, not a multiplier: an off-duty
//   guardian is out of the set entirely (scoring them down instead
//   would still fan an alert to someone who said they are off duty).
// - rating is NEUTRAL 1.0 for every guardian: no rating/reputation
//   data exists anywhere yet, and inventing it would be fake data.
//   The factor is carried so D23 (strikes/reputation) can plug real
//   values in without changing the matcher.
// - distance factor is linear: 1 at the victim, 0 at the radius edge.
//   score = rating × max(0, 1 − distanceKm / radiusKm), 3 decimals.
//
// Locations (storage): Upstash GEO key `guardians:geo` (member =
// guardian id — never PII in the key) is the shared candidate index,
// an Upstash cache key `guardians:loc:<id>` holds {lat, lng,
// updatedAt} with a 600 s TTL (the shared freshness record), and a
// per-instance memory map is the fast path (same shape as
// guardianStore/journeyStore: memory first, shared store second).
// Postgres holds NO location: a 10-min-lived pin mirrored to a
// table would be stale the moment the instance changes. A location
// older than LOCATION_TTL_MS (10 min) is stale and never matches.
//
// Privacy: guardian exact coordinates NEVER leave the server —
// rankCandidates returns distanceKm (rounded to 0.1) + score + public
// guardian fields only. Audit events carry guardianId only.
const { isValidLatitude, isValidLongitude } = require("../lib/validate");
const { redisStatus, geoAdd, geoSearch, geoRem, cacheGet, cacheSet } = require("./redis");
const guardianStore = require("./guardianStore");

const GUARDIAN_GEO_KEY = "guardians:geo";
const LOCATION_KEY_PREFIX = "guardians:loc:";
const DEFAULT_RADIUS_KM = 2; // plan §3 F2: 2 km radius for guardians
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 10;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MATCH_CANDIDATE_CAP = 50; // bound the per-candidate reads below
const LOCATION_TTL_MS = 10 * 60 * 1000; // a pin older than this never matches
const LOCATION_CACHE_TTL_SEC = 600;

// Per-instance fast path for locations (see header). Entries are
// { lat, lng, updatedAt } — the same shape cacheSet stores.
const locations = new Map();

// --- Pure: distance + score + rank ---

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};

const scoreGuardian = ({ distanceKm, radiusKm, rating = 1 } = {}) => {
  const d = typeof distanceKm === "number" && Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  const r = typeof radiusKm === "number" && Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : DEFAULT_RADIUS_KM;
  const rate = typeof rating === "number" && Number.isFinite(rating) ? Math.max(0, Math.min(1, rating)) : 1;
  return Math.round(rate * Math.max(0, 1 - d / r) * 1000) / 1000;
};

const isFresh = (updatedAt, nowMs) => {
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && nowMs - t <= LOCATION_TTL_MS;
};

// Rank pre-fetched candidates: [{ guardian, lat, lng, updatedAt }].
// Filters verified + available + fresh + within radius; sorts score
// desc (distance asc on ties); returns the public shape — no coords.
const rankCandidates = (candidates, { lat, lng, radiusKm, nowMs = Date.now() } = {}) => {
  if (!isValidLatitude(lat)) throw new Error("Invalid latitude");
  if (!isValidLongitude(lng)) throw new Error("Invalid longitude");
  if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new Error("Invalid radius");
  }
  const searchLat = Number(lat);
  const searchLng = Number(lng);
  const ranked = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const g = c && c.guardian;
    if (!g || g.state !== "verified" || !g.available) continue;
    if (!isFresh(c.updatedAt, nowMs)) continue;
    if (!isValidLatitude(c.lat) || !isValidLongitude(c.lng)) continue;
    // A caller that already knows the distance (GEO WITHDIST) may
    // pass it in — same number the haversine would produce, one less
    // recompute per candidate. Otherwise compute it here.
    const distanceKm =
      typeof c.distanceKm === "number" && Number.isFinite(c.distanceKm)
        ? c.distanceKm
        : haversineKm(searchLat, searchLng, Number(c.lat), Number(c.lng));
    if (distanceKm > radiusKm) continue;
    ranked.push({
      id: g.id,
      name: g.name,
      role: g.role,
      available: true,
      distanceKm: Math.round(distanceKm * 10) / 10,
      score: scoreGuardian({ distanceKm, radiusKm }),
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
  return ranked;
};

// --- I/O: record + find ---

// Records a guardian's pin: memory (fast path) + Upstash GEO
// (shared candidate index) + Upstash cache (shared freshness
// record, 600 s TTL = LOCATION_TTL_MS). Never throws on a transport
// failure — the redis primitives degrade to empty values — but DOES
// throw on invalid coordinates: a bad pin must never be recorded.
const recordGuardianLocation = async (guardianId, lat, lng, { nowMs = Date.now() } = {}) => {
  if (!isValidLatitude(lat)) throw new Error("Invalid latitude");
  if (!isValidLongitude(lng)) throw new Error("Invalid longitude");
  const pin = { lat: Number(lat), lng: Number(lng), updatedAt: new Date(nowMs).toISOString() };
  locations.set(guardianId, pin);
  await geoAdd(GUARDIAN_GEO_KEY, pin.lng, pin.lat, guardianId);
  await cacheSet(`${LOCATION_KEY_PREFIX}${guardianId}`, pin, LOCATION_CACHE_TTL_SEC);
  return { guardianId, ...pin };
};

// Freshness read: memory first (same instance), then the cache key
// (another instance's pin — the 600 s TTL is the freshness clock, so
// a present key is fresh by construction; the timestamp is still
// checked, so a clock-skewed value cannot slip through). A stale
// memory pin falls through to the cache — a newer pin from another
// instance rescues it. Returns null when no fresh pin exists.
const readLocation = async (guardianId, nowMs) => {
  const mem = locations.get(guardianId);
  if (mem && isFresh(mem.updatedAt, nowMs)) return mem;
  if (!redisStatus().configured) return null;
  const cached = await cacheGet(`${LOCATION_KEY_PREFIX}${guardianId}`);
  if (!cached || typeof cached !== "object") return null;
  if (!isValidLatitude(cached.lat) || !isValidLongitude(cached.lng)) return null;
  if (!isFresh(cached.updatedAt, nowMs)) return null;
  return { lat: Number(cached.lat), lng: Number(cached.lng), updatedAt: cached.updatedAt };
};

// The D20 fan-out candidate set: verified + available guardians
// within radiusKm of (lat, lng), ranked best-first (rankCandidates),
// capped at `limit`. Upstash configured: GEOSEARCH WITHDIST gives
// the radius candidate set (bounded by MATCH_CANDIDATE_CAP before
// any per-candidate read); unconfigured: a memory scan (same
// serverless caveat as guardianStore). Stale members are GEO-cleaned
// lazily so the set does not rot.
const findNearbyGuardians = async ({ lat, lng, radiusKm = DEFAULT_RADIUS_KM, limit = DEFAULT_LIMIT, nowMs = Date.now() } = {}) => {
  if (!isValidLatitude(lat)) throw new Error("Invalid latitude");
  if (!isValidLongitude(lng)) throw new Error("Invalid longitude");
  if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new Error("Invalid radius");
  }
  const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit) || DEFAULT_LIMIT));
  const candidates = [];
  if (redisStatus().configured) {
    const found = await geoSearch(GUARDIAN_GEO_KEY, Number(lng), Number(lat), radiusKm, { withDist: true });
    for (const row of found.slice(0, MATCH_CANDIDATE_CAP)) {
      const member = row && row.member;
      if (typeof member !== "string") continue;
      const guardian = await guardianStore.get(member);
      if (!guardian) {
        await geoRem(GUARDIAN_GEO_KEY, member);
        continue;
      }
      const loc = await readLocation(member, nowMs);
      if (!loc) {
        await geoRem(GUARDIAN_GEO_KEY, member);
        continue;
      }
      candidates.push({ guardian, lat: loc.lat, lng: loc.lng, updatedAt: loc.updatedAt, distanceKm: row.distanceKm });
    }
  } else {
    for (const [member, loc] of locations) {
      const guardian = await guardianStore.get(member);
      if (!guardian) continue;
      candidates.push({ guardian, lat: loc.lat, lng: loc.lng, updatedAt: loc.updatedAt });
    }
  }
  return rankCandidates(candidates, { lat, lng, radiusKm, nowMs }).slice(0, lim);
};

module.exports = {
  GUARDIAN_GEO_KEY,
  LOCATION_KEY_PREFIX,
  DEFAULT_RADIUS_KM,
  MIN_RADIUS_KM,
  MAX_RADIUS_KM,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MATCH_CANDIDATE_CAP,
  LOCATION_TTL_MS,
  LOCATION_CACHE_TTL_SEC,
  haversineKm,
  scoreGuardian,
  rankCandidates,
  recordGuardianLocation,
  findNearbyGuardians,
  // Test seams only.
  _locations: locations,
};
