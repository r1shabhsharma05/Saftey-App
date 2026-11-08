// Safe-places D13 tests — SafeLife 2.0 Day 13: Upstash cache tier,
// open-now filter, and distance/openNow annotation on the live proxy.
// No real Overpass or Upstash call leaves this process: axios.get and
// the redis transport are stubbed per test, then restored.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const axios = require("axios");

const {
  lookupSafePlaces,
  isOpenNow,
  getCacheStats,
} = require("../services/safePlaces");
const { _setRedisTransport } = require("../services/redis");
const safePlacesRouter = require("../routes/safePlaces");

const withEnv = async (overrides, fn) => {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
};

const CONFIGURED = {
  UPSTASH_REDIS_REST_URL: "https://fake-upstash.example",
  UPSTASH_REDIS_REST_TOKEN: "d13-fake-token",
};
const UNCONFIGURED = {
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

// Weekdays fixed to the 2026-11-02 week (Mon 2nd … Sun 8th), as absolute
// UTC instants with their IST wall-clock in the comment: every isOpenNow
// call passes TZ = "Asia/Kolkata", so the verdict is the place's local
// time whatever the VM timezone is (M4).
const MON_10 = new Date(Date.UTC(2026, 10, 2, 4, 30));
const MON_14 = new Date(Date.UTC(2026, 10, 2, 8, 30));
const MON_1230 = new Date(Date.UTC(2026, 10, 2, 7, 0));
const MON_20 = new Date(Date.UTC(2026, 10, 2, 14, 30));
const SAT_01 = new Date(Date.UTC(2026, 10, 6, 19, 30));
const SAT_03 = new Date(Date.UTC(2026, 10, 6, 21, 30));
const SAT_10 = new Date(Date.UTC(2026, 10, 7, 4, 30));
const SAT_12 = new Date(Date.UTC(2026, 10, 7, 6, 30));
const SAT_15 = new Date(Date.UTC(2026, 10, 7, 9, 30));
const FRI_2330 = new Date(Date.UTC(2026, 10, 6, 18, 0));
const SUN_10 = new Date(Date.UTC(2026, 10, 8, 4, 30));
const TUE_10 = new Date(Date.UTC(2026, 10, 3, 4, 30));
const TZ = "Asia/Kolkata";

test("isOpenNow: 24/7, missing, and unparseable hours", () => {
  assert.equal(isOpenNow("24/7", MON_10, TZ), true);
  assert.equal(isOpenNow(undefined, MON_10, TZ), null);
  assert.equal(isOpenNow("sunrise-sunset", MON_10, TZ), null);
  assert.equal(isOpenNow("Mo-Fr blah", MON_10, TZ), null);
});

test("isOpenNow: weekday range, covered day closed, uncovered day unknown", () => {
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_10, TZ), true);
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_20, TZ), false);
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", SAT_10, TZ), null);
  assert.equal(isOpenNow("Sa 10:00-14:00", SAT_12, TZ), true);
  assert.equal(isOpenNow("Sa 10:00-14:00", SAT_15, TZ), false);
});

test("isOpenNow: several rules on one day — open beats closed", () => {
  assert.equal(isOpenNow("Mo 09:00-12:00; Mo 13:00-18:00", MON_14, TZ), true);
  assert.equal(isOpenNow("Mo 09:00-12:00; Mo 13:00-18:00", MON_1230, TZ), false);
  assert.equal(isOpenNow("Mo 09:00-12:00,13:00-18:00", MON_14, TZ), true);
  assert.equal(isOpenNow("Mo 09:00-12:00,13:00-18:00", MON_1230, TZ), false);
});

test("isOpenNow: overnight ranges span midnight into the next day", () => {
  assert.equal(isOpenNow("Fr 22:00-02:00", FRI_2330, TZ), true);
  assert.equal(isOpenNow("Fr 22:00-02:00", SAT_01, TZ), true);
  assert.equal(isOpenNow("Fr 22:00-02:00", SAT_03, TZ), null);
});

test("isOpenNow (M4): no zone or an invalid zone → null, never a guessed verdict", () => {
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_10), null, "no zone: unknown, not the server's local time");
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_10, "Not/AZone"), null);
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_10, ""), null);
  assert.equal(isOpenNow("24/7", MON_10), true, "24/7 is zone-independent");
  // Same instant, different zones: 14:30 UTC is 20:00 IST on Monday
  // (past closing) but 09:30 in New York on Monday (open) — the
  // verdict follows the zone given, not the server's clock.
  const MON_1430_UTC = new Date(Date.UTC(2026, 10, 2, 14, 30));
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_1430_UTC, "Asia/Kolkata"), false);
  assert.equal(isOpenNow("Mo-Fr 09:00-18:00", MON_1430_UTC, "America/New_York"), true);
});

test("isOpenNow: off, wrapped ranges, and bare time ranges", () => {
  assert.equal(isOpenNow("Mo off", MON_10, TZ), false);
  assert.equal(isOpenNow("Mo off", TUE_10, TZ), null);
  assert.equal(isOpenNow("Fr-Mo 09:00-18:00", SUN_10, TZ), true);
  assert.equal(isOpenNow("Fr-Mo 09:00-18:00", TUE_10, TZ), null);
  assert.equal(isOpenNow("09:00-18:00", SAT_10, TZ), true);
  assert.equal(isOpenNow("Mo-Su 00:00-24:00", SAT_10, TZ), true);
});

const stubAxios = (data) => {
  const orig = axios.get;
  axios.get = async () => ({ data });
  return () => {
    axios.get = orig;
  };
};

const stubTransport = (handler) => {
  const calls = [];
  _setRedisTransport(async (command, ...args) => {
    calls.push({ command, args });
    return handler(command, args);
  });
  return calls;
};

const rawPlaces = () => ({
  elements: [
    {
      type: "node",
      id: 1,
      lat: 28.1,
      lon: 77.1,
      tags: { amenity: "police", name: "Station", opening_hours: "24/7" },
    },
    {
      type: "way",
      id: 2,
      center: { lat: 28.2, lon: 77.2 },
      tags: { amenity: "hospital", name: "Clinic", opening_hours: "Mo-Fr 09:00-18:00" },
    },
    {
      type: "node",
      id: 3,
      tags: { amenity: "pharmacy", name: "NoCoords" },
    },
  ],
});

test("live fetch annotates distance + openNow and writes the Upstash cell", async () => {
  await withEnv(CONFIGURED, async () => {
    const calls = stubTransport((command) => (command === "get" ? null : "OK"));
    const restoreAxios = stubAxios(rawPlaces());
    try {
      const { data, cached, source } = await lookupSafePlaces(28.1, 77.1, { now: MON_10, timeZone: TZ });
      assert.equal(cached, false);
      assert.equal(source, "live");
      assert.equal(data.elements.length, 3);
      const [police, clinic, noCoords] = data.elements;
      assert.equal(police.distanceKm, 0);
      assert.equal(police.openNow, true);
      assert.ok(clinic.distanceKm > 0);
      assert.equal(clinic.openNow, true);
      assert.equal(noCoords.distanceKm, null);
      assert.equal(noCoords.openNow, null);
      // D15: each element carries its v1 safety score — police 24/7 at
      // 0 km clamps to 100 SAFE; the clinic (~14.8 km, open) is 75
      // MODERATE; the coord-less pharmacy is 60 MODERATE, unknown hours.
      assert.deepEqual(police.safety, {
        score: 100,
        band: "SAFE",
        reasons: ["Police station", "Open now", "0 m away"],
      });
      assert.deepEqual(clinic.safety, {
        score: 75,
        band: "MODERATE",
        reasons: ["Hospital", "Open now", "14.8 km away"],
      });
      assert.deepEqual(noCoords.safety, {
        score: 60,
        band: "MODERATE",
        reasons: ["Public place"],
      });
      const set = calls.find((c) => c.command === "set");
      assert.ok(set, "expected an Upstash SET");
      assert.equal(set.args[0], "safe-places:28.100,77.100");
      assert.equal(set.args[2], "ex");
      assert.equal(set.args[3], 300);
    } finally {
      restoreAxios();
    }
  });
});

test("Upstash hit serves without touching Overpass, then populates memory", async () => {
  await withEnv(CONFIGURED, async () => {
    const raw = rawPlaces();
    stubTransport(() => JSON.stringify(raw));
    const orig = axios.get;
    let fetches = 0;
    axios.get = async () => {
      fetches += 1;
      throw new Error("Overpass must not be called on an Upstash hit");
    };
    try {
      const first = await lookupSafePlaces(28.3, 77.3, { now: MON_10, timeZone: TZ });
      assert.equal(first.source, "upstash");
      assert.equal(first.cached, true);
      assert.equal(first.data.elements.length, 3);
      const second = await lookupSafePlaces(28.3, 77.3, { now: MON_10, timeZone: TZ });
      assert.equal(second.source, "memory");
      assert.equal(fetches, 0);
    } finally {
      axios.get = orig;
    }
  });
});

test("Upstash down degrades to a live fetch, never an error", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => {
      throw new Error("upstash down");
    });
    const restoreAxios = stubAxios(rawPlaces());
    try {
      const { source, cached } = await lookupSafePlaces(28.4, 77.4, { now: MON_10, timeZone: TZ });
      assert.equal(source, "live");
      assert.equal(cached, false);
    } finally {
      restoreAxios();
    }
  });
});

test("Upstash unconfigured: live fetch, zero transport calls", async () => {
  await withEnv(UNCONFIGURED, async () => {
    const calls = stubTransport(() => "OK");
    const restoreAxios = stubAxios(rawPlaces());
    try {
      const { source } = await lookupSafePlaces(28.5, 77.5, { now: MON_10, timeZone: TZ });
      assert.equal(source, "live");
      assert.equal(calls.length, 0);
    } finally {
      restoreAxios();
    }
  });
});

test("openNow filter drops only definitively-closed places", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    const raw = {
      elements: [
        { type: "node", id: 11, lat: 28.6, lon: 77.6, tags: { amenity: "police", opening_hours: "24/7" } },
        { type: "node", id: 12, lat: 28.61, lon: 77.61, tags: { amenity: "cafe", opening_hours: "Mo 00:00-00:01" } },
        { type: "node", id: 13, lat: 28.62, lon: 77.62, tags: { amenity: "hospital" } },
      ],
    };
    const restoreAxios = stubAxios(raw);
    try {
      const all = await lookupSafePlaces(28.6, 77.6, { now: MON_10, timeZone: TZ });
      assert.deepEqual(
        all.data.elements.map((el) => el.openNow),
        [true, false, null]
      );
      const filtered = await lookupSafePlaces(28.61, 77.61, { now: MON_10, openNow: true, timeZone: TZ });
      // Fresh cell, same raw payload: the closed cafe must be gone,
      // the unknown-hours hospital must stay.
      assert.deepEqual(
        filtered.data.elements.map((el) => el.id),
        [11, 13]
      );
    } finally {
      restoreAxios();
    }
  });
});

test("all mirrors failing with no cache throws 502", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    const orig = axios.get;
    axios.get = async () => {
      throw new Error("mirror down");
    };
    try {
      await assert.rejects(lookupSafePlaces(28.7, 77.7), (err) => err.status === 502);
    } finally {
      axios.get = orig;
    }
  });
});

test("route: cache header, openNow param, and coordinate validation", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawPlaces());
    const app = express();
    app.use(safePlacesRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const first = await fetch(`${base}/safe-places?lat=28.8&lng=77.8`);
      assert.equal(first.status, 200);
      assert.equal(first.headers.get("x-safeplaces-cache"), "live");
      const body = await first.json();
      assert.equal(body.elements.length, 3);
      assert.equal(body.elements[0].openNow, true);
      const second = await fetch(`${base}/safe-places?lat=28.8&lng=77.8`);
      assert.equal(second.headers.get("x-safeplaces-cache"), "memory");
      await second.json();
      // openNow=1 contract, time-independent: no returned element may
      // be definitively closed, whatever the real clock says.
      const filtered = await fetch(`${base}/safe-places?lat=28.81&lng=77.81&openNow=1`);
      assert.equal(filtered.status, 200);
      const filteredBody = await filtered.json();
      assert.ok(filteredBody.elements.length > 0);
      assert.ok(filteredBody.elements.every((el) => el.openNow !== false));
      const bad = await fetch(`${base}/safe-places?lat=999&lng=77.8`);
      assert.equal(bad.status, 400);
    } finally {
      restoreAxios();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("memory cache (L3): capped at 1000 cells, oldest evicted first", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    let fetches = 0;
    const orig = axios.get;
    axios.get = async () => {
      fetches += 1;
      return { data: rawPlaces() };
    };
    try {
      const before = fetches;
      for (let i = 0; i < 1001; i++) {
        await lookupSafePlaces(10 + i * 0.001, 10, { now: MON_10, timeZone: TZ });
      }
      // 4 mirrors race per lookup, so the stub sees 4 GETs per cell.
      assert.equal(fetches - before, 1001 * 4, "each fresh cell fetched once");
      assert.equal(getCacheStats().entries, 1000, "cap holds");
      // The first cell is gone (oldest evicted); the last is still cached.
      await lookupSafePlaces(10, 10, { now: MON_10, timeZone: TZ });
      assert.equal(fetches - before, 1002 * 4, "evicted cell re-fetches");
      await lookupSafePlaces(10 + 1000 * 0.001, 10, { now: MON_10, timeZone: TZ });
      assert.equal(fetches - before, 1002 * 4, "retained cell serves from memory");
    } finally {
      axios.get = orig;
    }
  });
});

test("stale fallback (L3): serves entries under 1 h old, 502s older ones", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawPlaces());
    const realNow = Date.now;
    try {
      await lookupSafePlaces(28.9, 77.9, { now: MON_10, timeZone: TZ });
      const origGet = axios.get;
      axios.get = async () => {
        throw new Error("mirror down");
      };
      try {
        // 30 min later: mirrors down → stale copy served.
        Date.now = () => realNow() + 30 * 60 * 1000;
        const stale = await lookupSafePlaces(28.9, 77.9, { now: MON_10, timeZone: TZ });
        assert.equal(stale.stale, true);
        assert.equal(stale.source, "memory-stale");
        // 2 h later: the entry is too old to serve → 502.
        Date.now = () => realNow() + 2 * 60 * 60 * 1000;
        await assert.rejects(
          lookupSafePlaces(28.9, 77.9, { now: MON_10, timeZone: TZ }),
          (err) => err.status === 502
        );
      } finally {
        axios.get = origGet;
      }
    } finally {
      Date.now = realNow;
      restoreAxios();
    }
  });
});

test("route (M4): tz param is accepted, an invalid tz is ignored, never a 400", async () => {
  await withEnv(CONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawPlaces());
    const app = express();
    app.use(safePlacesRouter);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const withTz = await fetch(`${base}/safe-places?lat=28.85&lng=77.85&tz=Asia%2FKolkata`);
      assert.equal(withTz.status, 200);
      const withTzBody = await withTz.json();
      assert.equal(withTzBody.elements.length, 3);
      const badTz = await fetch(`${base}/safe-places?lat=28.86&lng=77.86&tz=Not%2FAZone`);
      assert.equal(badTz.status, 200, "invalid tz is ignored, the lookup still works");
      const badTzBody = await badTz.json();
      assert.ok(badTzBody.elements.every((el) => el.openNow === null || el.tags.opening_hours === "24/7"));
    } finally {
      restoreAxios();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
