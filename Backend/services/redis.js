// 🔌 Upstash Redis — serverless connection layer + primitives (D2).
//
// Why Upstash REST, not a TCP client: the backend runs on Vercel
// serverless (30s cap, no long-lived process), so a persistent Redis
// connection is the wrong shape. Upstash's REST API is plain HTTPS —
// one request per command, nothing to keep alive. No new dependency:
// axios is already installed (telegram/safePlaces use it).
//
// Amendment A2 scope: GEO (guardian matching, D20), the fixed-window
// rate-limit primitive (SOS/delivery cross-instance counting, A3), and
// a generic cache (safe-places Upstash cache, D13). QStash jobs live
// in services/qstash.js; delivery/escalation consumers land in D4/D10.
//
// Degradation rule (deliberate, whole file): shared-state primitives
// NEVER throw — without config they return their empty value, on a
// transport error they log and return their empty value. A cache or GEO
// miss must never fail a safety request; callers that need a verdict
// (the SOS limiter) fail OPEN, matching the emergency-must-never-lock
// rationale in middleware/rateLimit.js.
//
// Config is read per call (not at module load like telegram.js): tests
// can toggle env freely, and a long-lived process never caches a stale
// value. Cost is one property lookup per call.
const axios = require("axios");

const getConfig = () => ({
  url: (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""),
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

const redisStatus = () => {
  const { url, token } = getConfig();
  return { configured: Boolean(url && token) };
};

// Production transport: POST {url}/{COMMAND}/{arg}/... with a Bearer
// token. Upstash answers { result } or { error }.
let transport = async (command, ...args) => {
  const { url, token } = getConfig();
  const path = [command, ...args.map((a) => encodeURIComponent(String(a)))].join("/");
  const resp = await axios.post(`${url}/${path}`, null, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5000,
  });
  if (resp.data && resp.data.error) {
    throw new Error(`Upstash error: ${resp.data.error}`);
  }
  return resp.data ? resp.data.result : undefined;
};

// Generic cache primitive (D13 safe-places cache). Values are JSON;
// a foreign (non-JSON) value is returned raw rather than throwing.
const cacheGet = async (key) => {
  if (!redisStatus().configured) return null;
  try {
    const result = await transport("get", key);
    if (result === null || result === undefined) return null;
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  } catch (err) {
    console.log("❌ Upstash cacheGet failed:", err.message);
    return null;
  }
};

const cacheSet = async (key, value, ttlSec) => {
  if (!redisStatus().configured) return false;
  try {
    await transport("set", key, JSON.stringify(value), "ex", ttlSec);
    return true;
  } catch (err) {
    console.log("❌ Upstash cacheSet failed:", err.message);
    return false;
  }
};

// GEO primitives (D20 guardian matching): members are caller-chosen
// IDs (user IDs), never PII in the key itself.
const geoAdd = async (key, lng, lat, member) => {
  if (!redisStatus().configured) return 0;
  try {
    return await transport("geoadd", key, lng, lat, member);
  } catch (err) {
    console.log("❌ Upstash geoAdd failed:", err.message);
    return 0;
  }
};

const geoSearch = async (key, lng, lat, radiusKm) => {
  if (!redisStatus().configured) return [];
  try {
    const result = await transport(
      "geosearch",
      key,
      "fromlonlat",
      lng,
      lat,
      "byradius",
      radiusKm,
      "km"
    );
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.log("❌ Upstash geoSearch failed:", err.message);
    return [];
  }
};

// Fixed-window counter. INCR is atomic, so only the caller that sees 1
// sets the TTL — the window is exact. If setting the TTL fails, the
// key is deleted instead of left to wedge the bucket full forever.
const checkRateLimit = async (key, limit, windowSec) => {
  if (!redisStatus().configured) return null;
  try {
    const count = await transport("incr", key);
    if (count === 1) {
      try {
        await transport("expire", key, windowSec);
      } catch {
        await transport("del", key).catch(() => {});
        return null;
      }
    }
    return { allowed: count <= limit, count };
  } catch (err) {
    console.log("❌ Upstash checkRateLimit failed:", err.message);
    return null;
  }
};

// express-rate-limit Store backed by the primitive above. The library
// calls init(options) once with { windowMs, limit } — that is where the
// bucket parameters come from, not the constructor. Keys are prefixed
// (rl:) so limiter buckets never collide with cache/GEO keys.
// decrement/resetKey exist because the Store interface offers them;
// the request path never calls them (no skip* options are enabled).
const createUpstashStore = () => {
  let limit = 0;
  let windowMs = 0;
  return {
    init(options) {
      limit = options.limit;
      windowMs = options.windowMs;
    },
    async increment(key) {
      // Fail OPEN: if Upstash is down or init never ran, an SOS must
      // never be blocked by limiter infrastructure (totalHits 0 = under
      // any limit). The outage is logged, not hidden.
      try {
        if (!limit || !windowMs) return { totalHits: 0, resetTime: new Date() };
        const verdict = await checkRateLimit(`rl:${key}`, limit, Math.ceil(windowMs / 1000));
        if (!verdict) return { totalHits: 0, resetTime: new Date(Date.now() + windowMs) };
        // resetTime is header-only precision: the true reset is the Redis
        // TTL set on the window's first hit, which the library never
        // sees. Window enforcement itself is exact (TTL expiry).
        return { totalHits: verdict.count, resetTime: new Date(Date.now() + windowMs) };
      } catch (err) {
        console.log("❌ Upstash store increment failed, failing open:", err.message);
        return { totalHits: 0, resetTime: new Date() };
      }
    },
    async decrement(key) {
      try {
        await transport("decr", `rl:${key}`);
      } catch {
        // Best-effort only; a missed decrement just leaves headroom.
      }
    },
    async resetKey(key) {
      try {
        await transport("del", `rl:${key}`);
      } catch {
        // Best-effort only.
      }
    },
  };
};

module.exports = {
  redisStatus,
  cacheGet,
  cacheSet,
  geoAdd,
  geoSearch,
  checkRateLimit,
  createUpstashStore,
  // Test seam only — lets tests drive the primitives without network.
  _setRedisTransport: (fn) => {
    transport = fn;
  },
};
