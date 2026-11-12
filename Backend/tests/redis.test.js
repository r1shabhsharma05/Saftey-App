// Unit tests for services/redis.js — the D2 Upstash wiring + primitives.
// Fake env + fake transport: no network, no real Upstash account needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

const {
  redisStatus,
  cacheGet,
  cacheSet,
  geoAdd,
  geoSearch,
  geoRem,
  checkRateLimit,
  createUpstashStore,
  _setRedisTransport,
} = require("../services/redis");

// Minimal in-memory Upstash: enough semantics for the primitives' tests.
const kv = new Map();
const ttls = new Map();
const geo = new Map();
const calls = [];
// The fake Upstash stores GEO members WITH coords so a WITHDIST
// search can answer a real distance (same shape the real service
// returns: [[member, "0.977"], ...]). Distances are haversine —
// this is the fake's own implementation, not the code under test.
const fakeHaversineKm = (lng1, lat1, lng2, lat2) => {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};
const fakeTransport = async (command, ...args) => {
  calls.push([command, ...args]);
  switch (command) {
    case "get":
      return kv.has(args[0]) ? kv.get(args[0]) : null;
    case "set":
      kv.set(args[0], args[1]);
      return "OK";
    case "incr": {
      const next = (Number(kv.get(args[0])) || 0) + 1;
      kv.set(args[0], String(next));
      return next;
    }
    case "expire":
      ttls.set(args[0], args[1]);
      return 1;
    case "del":
      kv.delete(args[0]);
      ttls.delete(args[0]);
      return 1;
    case "ttl":
      if (!kv.has(args[0])) return -2;
      return ttls.has(args[0]) ? ttls.get(args[0]) : -1;
    case "geoadd": {
      if (!geo.has(args[0])) geo.set(args[0], []);
      geo.get(args[0]).push({ member: args[3], lng: Number(args[1]), lat: Number(args[2]) });
      return 1;
    }
    case "geosearch": {
      // args: key, "fromlonlat", lng, lat, "byradius", radiusKm, "km", ["withdist"]
      const members = geo.has(args[0]) ? geo.get(args[0]) : [];
      const lng = Number(args[2]);
      const lat = Number(args[3]);
      const radiusKm = Number(args[5]);
      const within = members.filter((m) => fakeHaversineKm(lng, lat, m.lng, m.lat) <= radiusKm);
      if (args.includes("withdist")) {
        return within.map((m) => [m.member, fakeHaversineKm(lng, lat, m.lng, m.lat).toFixed(3)]);
      }
      return within.map((m) => m.member);
    }
    case "zrem": {
      if (!geo.has(args[0])) return 0;
      const list = geo.get(args[0]);
      const idx = list.findIndex((m) => m.member === args[1]);
      if (idx === -1) return 0;
      list.splice(idx, 1);
      return 1;
    }
    default:
      throw new Error(`unexpected command ${command}`);
  }
};
_setRedisTransport(fakeTransport);

test("redisStatus reports configured, never the token", () => {
  const st = redisStatus();
  assert.equal(st.configured, true);
  assert.ok(!JSON.stringify(st).includes("fake-token"));
});

test("cache round-trip stores JSON and reads it back", async () => {
  assert.equal(await cacheSet("k1", { a: 1 }, 300), true);
  assert.deepEqual(await cacheGet("k1"), { a: 1 });
});

test("cacheGet on a missing key returns null", async () => {
  assert.equal(await cacheGet("nope"), null);
});

test("geoAdd + geoSearch round-trip members", async () => {
  assert.equal(await geoAdd("guardians", 77.2, 28.6, "g1"), 1);
  assert.deepEqual(await geoSearch("guardians", 77.2, 28.6, 2), ["g1"]);
});

test("checkRateLimit counts a fixed window and blocks past the limit", async () => {
  const before = calls.length;
  assert.deepEqual(await checkRateLimit("rl-test", 2, 60), { allowed: true, count: 1 });
  assert.deepEqual(await checkRateLimit("rl-test", 2, 60), { allowed: true, count: 2 });
  assert.deepEqual(await checkRateLimit("rl-test", 2, 60), { allowed: false, count: 3 });
  // Only the first hit in a window sets the TTL.
  const expires = calls.slice(before).filter((c) => c[0] === "expire");
  assert.equal(expires.length, 1);
  assert.deepEqual(expires[0], ["expire", "rl-test", 60]);
});

test("upstash store: increment counts, namespaces keys, reports resetTime", async () => {
  const store = createUpstashStore();
  store.init({ windowMs: 15 * 60 * 1000, limit: 30 });
  const before = calls.length;
  const first = await store.increment("1.2.3.4");
  assert.equal(first.totalHits, 1);
  assert.ok(first.resetTime instanceof Date);
  const second = await store.increment("1.2.3.4");
  assert.equal(second.totalHits, 2);
  // Only the store's own increments: the primitive test above uses its
  // own bare key ("rl-test"), which the store never sees.
  const incrKeys = calls.slice(before).filter((c) => c[0] === "incr").map((c) => c[1]);
  assert.deepEqual(incrKeys, ["rl:1.2.3.4", "rl:1.2.3.4"]);
});

test("upstash store fails open when Upstash is down", async () => {
  _setRedisTransport(async () => {
    throw new Error("boom");
  });
  try {
    const store = createUpstashStore();
    store.init({ windowMs: 15 * 60 * 1000, limit: 30 });
    const res = await store.increment("9.9.9.9");
    assert.equal(res.totalHits, 0);
    assert.ok(res.resetTime instanceof Date);
  } finally {
    _setRedisTransport(fakeTransport);
  }
});

test("upstash store: namespaces isolate limiter counters", async () => {
  // (NV1) Two limiters keyed on the same IP must not share a counter:
  // without namespaces a /safe-places burst would spend the tracking
  // allowance. The bare store keeps the SOS keys unchanged.
  const tracking = createUpstashStore("tracking");
  const safePlaces = createUpstashStore("safe-places");
  tracking.init({ windowMs: 60 * 1000, limit: 60 });
  safePlaces.init({ windowMs: 60 * 1000, limit: 30 });
  const before = calls.length;
  await tracking.increment("1.2.3.4");
  await safePlaces.increment("1.2.3.4");
  const incrKeys = calls.slice(before).filter((c) => c[0] === "incr").map((c) => c[1]);
  assert.deepEqual(incrKeys, ["rl:tracking:1.2.3.4", "rl:safe-places:1.2.3.4"]);
});

test("unconfigured primitives degrade to null/false, never throw", async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    assert.equal(redisStatus().configured, false);
    assert.equal(await cacheGet("k1"), null);
    assert.equal(await cacheSet("k1", { a: 1 }, 300), false);
    assert.deepEqual(await geoSearch("guardians", 77.2, 28.6, 2), []);
    assert.equal(await checkRateLimit("rl-test", 2, 60), null);
  } finally {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  }
});

test("checkRateLimit (L2): a transient EXPIRE failure is retried once, then the TTL holds", async () => {
  let expires = 0;
  _setRedisTransport(async (command, ...args) => {
    if (command === "incr") return 1;
    if (command === "expire") {
      expires += 1;
      if (expires === 1) throw new Error("transient");
      return 1;
    }
    if (command === "ttl") return 60;
    throw new Error(`unexpected ${command}`);
  });
  try {
    assert.deepEqual(await checkRateLimit("retry-key", 2, 60), { allowed: true, count: 1 });
    assert.equal(expires, 2, "EXPIRE was retried once");
  } finally {
    _setRedisTransport(fakeTransport);
  }
});

test("checkRateLimit (L2): EXPIRE failing twice falls back to DEL and fails open", async () => {
  _setRedisTransport(async (command, ...args) => {
    if (command === "incr") return 1;
    if (command === "expire") throw new Error("expire down");
    if (command === "del") return 1;
    throw new Error(`unexpected ${command}`);
  });
  try {
    assert.equal(await checkRateLimit("del-key", 2, 60), null);
  } finally {
    _setRedisTransport(fakeTransport);
  }
});

test("checkRateLimit (L2): a TTL-less key self-heals on the next hit", async () => {
  // Seed a wedged key: count 5, no TTL (as if an earlier EXPIRE+DEL
  // both failed). The next hit must notice ttl === -1 and set one.
  kv.set("heal-key", "5");
  ttls.delete("heal-key");
  const before = calls.length;
  const verdict = await checkRateLimit("heal-key", 10, 60);
  assert.deepEqual(verdict, { allowed: true, count: 6 });
  const expires = calls.slice(before).filter((c) => c[0] === "expire" && c[1] === "heal-key");
  assert.equal(expires.length, 1);
  assert.equal(ttls.get("heal-key"), 60);
});

test("geoSearch withDist returns member + numeric distanceKm", async () => {
  await geoAdd("geo-dist", 77.2, 28.6, "d1");
  await geoAdd("geo-dist", 77.21, 28.6, "d2");
  const res = await geoSearch("geo-dist", 77.2, 28.6, 2, { withDist: true });
  assert.equal(res.length, 2);
  assert.equal(res[0].member, "d1");
  assert.equal(res[0].distanceKm, 0);
  assert.equal(res[1].member, "d2");
  // 0.01° longitude at 28.6°N ≈ 0.977 km — range, not an exact
  // literal, because the fake rounds to 3 decimals.
  assert.ok(res[1].distanceKm > 0.9 && res[1].distanceKm < 1.0);
});

test("geoSearch without withDist still returns plain members", async () => {
  assert.deepEqual(await geoSearch("geo-dist", 77.2, 28.6, 2), ["d1", "d2"]);
});

test("geoRem removes a member and reports 0 for a missing one", async () => {
  await geoAdd("geo-rem", 77.2, 28.6, "r1");
  assert.equal(await geoRem("geo-rem", "r1"), 1);
  assert.equal(await geoRem("geo-rem", "r1"), 0);
  assert.deepEqual(await geoSearch("geo-rem", 77.2, 28.6, 2), []);
});
