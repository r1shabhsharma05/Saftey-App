// Unit tests for services/guardianMatch.js — SafeLife 2.0 Day 20
// (GEO matching engine: radius search, ranking, fan-out candidates).
// Pure part first (haversine, scoring, ranking); I/O part below
// drives the real redis/guardianStore seams with a fake transport.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  haversineKm,
  scoreGuardian,
  rankCandidates,
  DEFAULT_RADIUS_KM,
  LOCATION_TTL_MS,
} = require("../services/guardianMatch");

const NOW = Date.parse("2026-11-12T08:00:00.000Z");
const freshAt = new Date(NOW - 60 * 1000).toISOString();
// Literal 10 min — pins the TTL in the fixture itself. Deriving
// this from the imported LOCATION_TTL_MS would adapt to a mutation
// of the constant instead of catching it (same smell D19 fixed on
// the 5-attempt kill-test).
const staleAt = new Date(NOW - 10 * 60 * 1000 - 1000).toISOString();

const guardian = (over = {}) => ({
  id: "g1",
  userId: "u1",
  name: "Asha",
  phone: "+919999999999",
  role: "family",
  state: "verified",
  available: true,
  verifiedAt: "2026-11-11T00:00:00.000Z",
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  verification: null,
  codeRequests: [],
  ...over,
});

// --- haversineKm ---

test("LOCATION_TTL_MS is 10 minutes (literal pin — a location older than this never matches)", () => {
  assert.equal(LOCATION_TTL_MS, 10 * 60 * 1000);
});

test("haversineKm: 1 degree of latitude at the equator is ~111.195 km", () => {
  const d = haversineKm(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111.195) < 0.01, `got ${d}`);
});

test("haversineKm: same point is 0", () => {
  assert.equal(haversineKm(28.6, 77.2, 28.6, 77.2), 0);
});

test("haversineKm: Mathura to Delhi is ~126 km (sanity range)", () => {
  // GLA University, Mathura (27.492, 77.673) → Connaught Place (28.631, 77.217).
  const d = haversineKm(27.492, 77.673, 28.631, 77.217);
  assert.ok(d > 120 && d < 135, `got ${d}`);
});

// --- scoreGuardian ---

test("scoreGuardian: at the victim it is 1, at the radius edge 0", () => {
  assert.equal(scoreGuardian({ distanceKm: 0, radiusKm: 2 }), 1);
  assert.equal(scoreGuardian({ distanceKm: 1, radiusKm: 2 }), 0.5);
  assert.equal(scoreGuardian({ distanceKm: 2, radiusKm: 2 }), 0);
});

test("scoreGuardian: beyond the radius clamps to 0, never negative", () => {
  assert.equal(scoreGuardian({ distanceKm: 5, radiusKm: 2 }), 0);
});

test("scoreGuardian: rating scales the score (neutral 1.0 by default)", () => {
  assert.equal(scoreGuardian({ distanceKm: 0, radiusKm: 2, rating: 0.5 }), 0.5);
  assert.equal(scoreGuardian({ distanceKm: 1, radiusKm: 2, rating: 0.5 }), 0.25);
  assert.equal(scoreGuardian({ distanceKm: 0, radiusKm: 2 }), 1);
});

// --- rankCandidates ---

test("rankCandidates: nearest verified + available + fresh guardian ranks first", () => {
  const near = { guardian: guardian({ id: "near" }), lat: 28.601, lng: 77.201, updatedAt: freshAt };
  const far = { guardian: guardian({ id: "far" }), lat: 28.61, lng: 77.21, updatedAt: freshAt };
  const ranked = rankCandidates([far, near], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, "near");
  assert.equal(ranked[1].id, "far");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].distanceKm < ranked[1].distanceKm);
});

test("rankCandidates: pending guardians never match", () => {
  const c = { guardian: guardian({ id: "p1", state: "pending" }), lat: 28.6, lng: 77.2, updatedAt: freshAt };
  assert.deepEqual(
    rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW }),
    []
  );
});

test("rankCandidates: unavailable guardians never match", () => {
  const c = { guardian: guardian({ id: "o1", available: false }), lat: 28.6, lng: 77.2, updatedAt: freshAt };
  assert.deepEqual(
    rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW }),
    []
  );
});

test("rankCandidates: stale locations (older than 10 min) never match", () => {
  const c = { guardian: guardian({ id: "s1" }), lat: 28.6, lng: 77.2, updatedAt: staleAt };
  assert.deepEqual(
    rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW }),
    []
  );
});

test("rankCandidates: guardians beyond the radius never match", () => {
  // ~11 km away: outside the default 2 km radius.
  const c = { guardian: guardian({ id: "b1" }), lat: 28.7, lng: 77.2, updatedAt: freshAt };
  assert.deepEqual(
    rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW }),
    []
  );
});

test("rankCandidates: output carries distanceKm + score but NEVER coordinates", () => {
  const c = { guardian: guardian({ id: "g1" }), lat: 28.601, lng: 77.201, updatedAt: freshAt };
  const [one] = rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW });
  assert.equal(one.id, "g1");
  assert.equal(one.name, "Asha");
  assert.equal(one.role, "family");
  assert.equal(one.available, true);
  assert.ok(typeof one.distanceKm === "number" && one.distanceKm > 0);
  assert.ok(typeof one.score === "number" && one.score > 0 && one.score <= 1);
  assert.ok(!("lat" in one) && !("lng" in one), "coordinates must not leak");
  assert.equal(JSON.stringify(one).includes("28.601"), false);
});

test("rankCandidates: distanceKm is rounded to 0.1 km", () => {
  const c = { guardian: guardian({ id: "g1" }), lat: 28.601, lng: 77.201, updatedAt: freshAt };
  const [one] = rankCandidates([c], { lat: 28.6, lng: 77.2, radiusKm: DEFAULT_RADIUS_KM, nowMs: NOW });
  assert.equal(one.distanceKm, Math.round(one.distanceKm * 10) / 10);
});

test("rankCandidates: invalid search point throws, never silently matches the world", () => {
  assert.throws(
    () => rankCandidates([], { lat: 91, lng: 77.2, radiusKm: 2, nowMs: NOW }),
    /Invalid latitude/
  );
  assert.throws(
    () => rankCandidates([], { lat: 28.6, lng: 200, radiusKm: 2, nowMs: NOW }),
    /Invalid longitude/
  );
  assert.throws(
    () => rankCandidates([], { lat: 28.6, lng: 77.2, radiusKm: 0, nowMs: NOW }),
    /Invalid radius/
  );
});

// --- I/O: recordGuardianLocation + findNearbyGuardians ---
// Fake Upstash transport (same shape as tests/redis.test.js) + the
// real guardianStore, seeded per test.
process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

const {
  recordGuardianLocation,
  findNearbyGuardians,
  _locations,
} = require("../services/guardianMatch");
const { _setRedisTransport } = require("../services/redis");
const guardianStore = require("../services/guardianStore");

const kv2 = new Map();
const geo2 = new Map();
const calls2 = [];
const fakeHaversineKm2 = (lng1, lat1, lng2, lat2) => {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
};
const fakeTransport2 = async (command, ...args) => {
  calls2.push([command, ...args]);
  switch (command) {
    case "get":
      return kv2.has(args[0]) ? kv2.get(args[0]) : null;
    case "set":
      kv2.set(args[0], args[1]);
      return "OK";
    case "geoadd": {
      if (!geo2.has(args[0])) geo2.set(args[0], []);
      geo2.get(args[0]).push({ member: args[3], lng: Number(args[1]), lat: Number(args[2]) });
      return 1;
    }
    case "geosearch": {
      const members = geo2.has(args[0]) ? geo2.get(args[0]) : [];
      const lng = Number(args[2]);
      const lat = Number(args[3]);
      const radiusKm = Number(args[5]);
      const within = members.filter((m) => fakeHaversineKm2(lng, lat, m.lng, m.lat) <= radiusKm);
      if (args.includes("withdist")) {
        return within.map((m) => [m.member, fakeHaversineKm2(lng, lat, m.lng, m.lat).toFixed(3)]);
      }
      return within.map((m) => m.member);
    }
    case "zrem": {
      if (!geo2.has(args[0])) return 0;
      const list = geo2.get(args[0]);
      const idx = list.findIndex((m) => m.member === args[1]);
      if (idx === -1) return 0;
      list.splice(idx, 1);
      return 1;
    }
    default:
      throw new Error(`unexpected command ${command}`);
  }
};
_setRedisTransport(fakeTransport2);

const seedGuardian = (over = {}) => {
  const g = guardian({ id: `g-${Math.random().toString(36).slice(2, 8)}`, ...over });
  guardianStore.save(g);
  return g;
};

const resetIO = () => {
  kv2.clear();
  geo2.clear();
  calls2.length = 0;
  _locations.clear();
  guardianStore._clearMemory();
};

test("recordGuardianLocation writes memory + GEO + cache and returns the pin", async () => {
  resetIO();
  const before = calls2.length;
  const pin = await recordGuardianLocation("g1", 28.6, 77.2, { nowMs: NOW });
  assert.equal(pin.guardianId, "g1");
  assert.equal(pin.lat, 28.6);
  assert.equal(pin.lng, 77.2);
  assert.equal(pin.updatedAt, new Date(NOW).toISOString());
  assert.deepEqual(_locations.get("g1"), { lat: 28.6, lng: 77.2, updatedAt: pin.updatedAt });
  const made = calls2.slice(before);
  assert.ok(made.some((c) => c[0] === "geoadd" && c[1] === "guardians:geo" && c[4] === "g1"));
  const setCall = made.find((c) => c[0] === "set" && c[1] === "guardians:loc:g1");
  assert.ok(setCall, "location cache key written");
  assert.equal(JSON.parse(setCall[2]).lat, 28.6);
  assert.equal(setCall[4], 600);
});

test("recordGuardianLocation throws on invalid coordinates, writes nothing", async () => {
  resetIO();
  await assert.rejects(() => recordGuardianLocation("g1", 91, 77.2), /Invalid latitude/);
  await assert.rejects(() => recordGuardianLocation("g1", 28.6, 200), /Invalid longitude/);
  await assert.rejects(() => recordGuardianLocation("g1", "x", 77.2), /Invalid latitude/);
  assert.equal(_locations.size, 0);
  assert.equal(calls2.length, 0);
});

test("findNearbyGuardians (Upstash): nearest first, pending/unavailable excluded", async () => {
  resetIO();
  const near = seedGuardian({ id: "near", name: "Near" });
  const far = seedGuardian({ id: "far", name: "Far" });
  const pending = seedGuardian({ id: "pend", state: "pending" });
  const offDuty = seedGuardian({ id: "off", available: false });
  await recordGuardianLocation(near.id, 28.601, 77.201, { nowMs: NOW });
  await recordGuardianLocation(far.id, 28.61, 77.21, { nowMs: NOW });
  await recordGuardianLocation(pending.id, 28.6, 77.2, { nowMs: NOW });
  await recordGuardianLocation(offDuty.id, 28.6, 77.2, { nowMs: NOW });
  const found = await findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 2, limit: 10, nowMs: NOW });
  assert.deepEqual(found.map((f) => f.id), ["near", "far"]);
  assert.ok(found[0].distanceKm < found[1].distanceKm);
  assert.ok(found[0].score > found[1].score);
  assert.ok(!("lat" in found[0]) && !("lng" in found[0]));
});

test("findNearbyGuardians: limit is honoured (nearest only)", async () => {
  resetIO();
  const a = seedGuardian({ id: "a" });
  const b = seedGuardian({ id: "b" });
  await recordGuardianLocation(a.id, 28.601, 77.201, { nowMs: NOW });
  await recordGuardianLocation(b.id, 28.61, 77.21, { nowMs: NOW });
  const found = await findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 2, limit: 1, nowMs: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "a");
});

test("findNearbyGuardians: stale member (no memory, no cache) is excluded + GEO-cleaned", async () => {
  resetIO();
  const g = seedGuardian({ id: "stale" });
  await recordGuardianLocation(g.id, 28.6, 77.2, { nowMs: NOW });
  // Simulate another instance's expired pin: memory gone, cache key gone.
  _locations.delete(g.id);
  kv2.delete("guardians:loc:stale");
  const before = calls2.length;
  const found = await findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 2, nowMs: NOW });
  assert.deepEqual(found, []);
  assert.ok(
    calls2.slice(before).some((c) => c[0] === "zrem" && c[1] === "guardians:geo" && c[2] === "stale"),
    "stale GEO member removed"
  );
});

test("findNearbyGuardians: stale memory pin is rescued by a fresh cache pin", async () => {
  resetIO();
  const g = seedGuardian({ id: "rescued" });
  await recordGuardianLocation(g.id, 28.6, 77.2, { nowMs: NOW });
  // Memory aged past the TTL; the cache key still holds the fresh pin.
  _locations.set(g.id, { lat: 28.6, lng: 77.2, updatedAt: staleAt });
  const found = await findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 2, nowMs: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "rescued");
});

test("findNearbyGuardians: unconfigured Upstash falls back to the memory scan", async () => {
  resetIO();
  const g = seedGuardian({ id: "mem" });
  await recordGuardianLocation(g.id, 28.601, 77.201, { nowMs: NOW });
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const found = await findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 2, nowMs: NOW });
    assert.equal(found.length, 1);
    assert.equal(found[0].id, "mem");
  } finally {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  }
});

test("findNearbyGuardians: invalid search point throws", async () => {
  resetIO();
  await assert.rejects(() => findNearbyGuardians({ lat: 91, lng: 77.2 }), /Invalid latitude/);
  await assert.rejects(() => findNearbyGuardians({ lat: 28.6, lng: 77.2, radiusKm: 0 }), /Invalid radius/);
});
