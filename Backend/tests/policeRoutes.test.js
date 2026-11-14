// Police layer D22 route tests — SafeLife 2.0 Day 22: GET /police/nearest.
// Real Express app over HTTP; axios + redis transport stubbed per test,
// no real Overpass or Upstash call leaves this process.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const axios = require("axios");

const policeRouter = require("../routes/police");
const { _setRedisTransport } = require("../services/redis");

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

const UNCONFIGURED = {
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

const stubAxios = (data) => {
  const orig = axios.get;
  axios.get = async () => ({ data });
  return () => {
    axios.get = orig;
  };
};

const stubTransport = (handler) => {
  _setRedisTransport(async (command, ...args) => handler(command, args));
};

const boot = async () => {
  const app = express();
  app.use(policeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const close = (server) => new Promise((resolve) => server.close(resolve));

const rawWithStation = () => ({
  elements: [
    {
      type: "node", id: 1, lat: 28.91, lon: 77.91,
      tags: { amenity: "police", name: "CP Police Station", phone: "011-2345 6789", opening_hours: "24/7" },
    },
    {
      type: "node", id: 2, lat: 28.93, lon: 77.93,
      tags: { amenity: "hospital", name: "City Hospital" },
    },
  ],
});

test("route: nearest station found — shape, phone, emergencyNumber, no key needed", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawWithStation());
    const { server, base } = await boot();
    try {
      // Deliberately NO x-api-key header: public map data, like /safe-places.
      const res = await fetch(`${base}/police/nearest?lat=28.91&lng=77.91`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.emergencyNumber, "112");
      assert.equal(body.station.name, "CP Police Station");
      assert.equal(body.station.phone, "011-2345 6789");
      assert.equal(body.station.distanceKm, 0);
      assert.equal(body.station.openNow, true);
      assert.equal(body.station.lat, 28.91);
      assert.equal(body.station.lng, 77.91);
      assert.equal(body.station.safety.band, "SAFE");
      assert.equal(body.reason, undefined);
      assert.equal(res.headers.get("x-safeplaces-cache"), "live");
    } finally {
      restoreAxios();
      await close(server);
    }
  });
});

test("route: no police nearby is an honest empty, never a fake station", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios({
      elements: [
        { type: "node", id: 2, lat: 28.92, lon: 77.92, tags: { amenity: "hospital", name: "City Hospital" } },
      ],
    });
    const { server, base } = await boot();
    try {
      const res = await fetch(`${base}/police/nearest?lat=28.92&lng=77.92`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.station, null);
      assert.equal(body.reason, "no-police-station-nearby");
      assert.equal(body.emergencyNumber, "112");
    } finally {
      restoreAxios();
      await close(server);
    }
  });
});

test("route: junk OSM phone never reaches the client", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios({
      elements: [
        { type: "node", id: 3, lat: 28.93, lon: 77.93, tags: { amenity: "police", name: "Station", phone: "call me" } },
      ],
    });
    const { server, base } = await boot();
    try {
      const res = await fetch(`${base}/police/nearest?lat=28.93&lng=77.93`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.station.phone, null);
    } finally {
      restoreAxios();
      await close(server);
    }
  });
});

test("route: invalid coordinates → 400", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawWithStation());
    const { server, base } = await boot();
    try {
      assert.equal((await fetch(`${base}/police/nearest?lat=999&lng=77.94`)).status, 400);
      assert.equal((await fetch(`${base}/police/nearest?lat=28.94`)).status, 400);
      assert.equal((await fetch(`${base}/police/nearest?lng=77.94`)).status, 400);
    } finally {
      restoreAxios();
      await close(server);
    }
  });
});

test("route: all mirrors failing → 502", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const orig = axios.get;
    axios.get = async () => {
      throw new Error("mirror down");
    };
    const { server, base } = await boot();
    try {
      const res = await fetch(`${base}/police/nearest?lat=28.95&lng=77.95`);
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
    } finally {
      axios.get = orig;
      await close(server);
    }
  });
});

test("route: invalid tz is ignored, never a 400", async () => {
  await withEnv(UNCONFIGURED, async () => {
    stubTransport(() => null);
    const restoreAxios = stubAxios(rawWithStation());
    const { server, base } = await boot();
    try {
      const res = await fetch(`${base}/police/nearest?lat=28.96&lng=77.96&tz=Not%2FAZone`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.station.name, "CP Police Station");
    } finally {
      restoreAxios();
      await close(server);
    }
  });
});
