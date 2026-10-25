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
  checkRateLimit,
  createUpstashStore,
  _setRedisTransport,
} = require("../services/redis");

// Minimal in-memory Upstash: enough semantics for the primitives' tests.
const kv = new Map();
const geo = new Map();
const calls = [];
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
    case "del":
      return 1;
    case "geoadd": {
      if (!geo.has(args[0])) geo.set(args[0], []);
      geo.get(args[0]).push(args[3]);
      return 1;
    }
    case "geosearch":
      return geo.has(args[0]) ? [...geo.get(args[0])] : [];
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
