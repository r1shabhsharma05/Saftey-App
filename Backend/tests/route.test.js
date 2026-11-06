// SafeLife 2.0 Day 14 — OSRM walking-route proxy tests.
// No real OSRM call leaves this process: axios.get is stubbed per test,
// then restored. Fixture geometry is the first points of a real OSRM
// answer for 28.6139,77.2090 → 28.6200,77.2150 (probed 2026-11-06).
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const axios = require("axios");

const { getWalkingRoute } = require("../services/route");
const routeRouter = require("../routes/route");

const osrmOk = () => ({
  code: "Ok",
  routes: [
    {
      legs: [{ steps: [], weight: 3674.6, summary: "", duration: 403.1, distance: 2968.6 }],
      weight_name: "routability",
      duration: 403.1,
      distance: 2968.6,
      geometry: {
        type: "LineString",
        coordinates: [
          [77.208773, 28.613927],
          [77.208665, 28.613932],
          [77.207537, 28.613986],
          [77.206496, 28.614035],
          [77.205319, 28.614091],
        ],
      },
    },
  ],
  waypoints: [
    { hint: "a", location: [77.208773, 28.613927], name: "" },
    { hint: "b", location: [77.205319, 28.614091], name: "" },
  ],
});

const stubAxios = (impl) => {
  const orig = axios.get;
  axios.get = impl;
  return () => {
    axios.get = orig;
  };
};

test("service: stubbed OSRM Ok returns rounded distance/duration + geometry", async () => {
  // Both hosts race: either may win, so assert on every URL seen, not
  // on one host — the contract is lng,lat order + geojson on both.
  const seenUrls = [];
  let seenOpts = null;
  const restore = stubAxios(async (url, opts) => {
    seenUrls.push(url);
    seenOpts = opts;
    return { data: osrmOk() };
  });
  try {
    const route = await getWalkingRoute(28.6139, 77.209, 28.62, 77.215);
    assert.equal(route.distanceM, 2969);
    assert.equal(route.durationS, 403);
    assert.deepEqual(route.coordinates, osrmOk().routes[0].geometry.coordinates);
    assert.equal(seenUrls.length, 2);
    for (const url of seenUrls) {
      // OSRM takes lng,lat — a lat/lng swap here would route across the map.
      assert.ok(url.includes("77.209,28.6139;77.215,28.62"), `URL was ${url}`);
      assert.ok(url.includes("geometries=geojson"), `URL was ${url}`);
    }
    assert.ok(seenUrls.some((u) => u.includes("/route/v1/foot/")));
    assert.ok(seenUrls.some((u) => u.includes("routing.openstreetmap.de/routed-foot/route/v1/driving/")));
    assert.equal(seenOpts.timeout, 10000);
  } finally {
    restore();
  }
});

test("service: OSRM NoRoute on every host rejects NO_ROUTE 502", async () => {
  const restore = stubAxios(async () => ({ data: { code: "NoRoute", routes: [] } }));
  try {
    await assert.rejects(
      getWalkingRoute(28.6139, 77.209, 28.62, 77.215),
      (err) => err.status === 502 && err.code === "NO_ROUTE"
    );
  } finally {
    restore();
  }
});

test("service: one host NoRoute + one host down is a generic 502, not NO_ROUTE", async () => {
  let n = 0;
  const restore = stubAxios(async () => {
    n += 1;
    if (n === 1) return { data: { code: "NoRoute", routes: [] } };
    throw new Error("host down");
  });
  try {
    await assert.rejects(
      getWalkingRoute(28.6139, 77.209, 28.62, 77.215),
      (err) => err.status === 502 && err.code === "UPSTREAM"
    );
  } finally {
    restore();
  }
});

test("service: all hosts down rejects 502", async () => {
  const restore = stubAxios(async () => {
    throw new Error("osrm down");
  });
  try {
    await assert.rejects(
      getWalkingRoute(28.6139, 77.209, 28.62, 77.215),
      (err) => err.status === 502
    );
  } finally {
    restore();
  }
});

test("service: Ok code but unusable geometry rejects 502", async () => {
  const bad = [
    { code: "Ok", routes: [] },
    { code: "Ok", routes: [{ distance: 100, duration: 60, geometry: { type: "LineString", coordinates: [[77.2, 28.6]] } }] },
    { code: "Ok", routes: [{ distance: "far", duration: 60, geometry: { type: "LineString", coordinates: [[77.2, 28.6], [77.3, 28.7]] } }] },
  ];
  for (const data of bad) {
    const restore = stubAxios(async () => ({ data }));
    try {
      await assert.rejects(getWalkingRoute(28.6139, 77.209, 28.62, 77.215), (err) => err.status === 502);
    } finally {
      restore();
    }
  }
});

test("route: HTTP leg — 200 shape, 400 on bad coords, 502 mapping", async () => {
  const restore = stubAxios(async () => ({ data: osrmOk() }));
  const app = express();
  app.use(routeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/route?fromLat=28.6139&fromLng=77.209&toLat=28.62&toLng=77.215`);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.success, true);
    assert.equal(body.distanceM, 2969);
    assert.equal(body.durationS, 403);
    assert.equal(body.coordinates.length, 5);

    const bad = await fetch(`${base}/route?fromLat=999&fromLng=77.209&toLat=28.62&toLng=77.215`);
    assert.equal(bad.status, 400);
    const missing = await fetch(`${base}/route?fromLat=28.6139&fromLng=77.209&toLat=28.62`);
    assert.equal(missing.status, 400);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("route: HTTP leg — a pair >25 km apart is rejected before OSRM is called", async () => {
  let calls = 0;
  const restore = stubAxios(async () => {
    calls += 1;
    return { data: osrmOk() };
  });
  const app = express();
  app.use(routeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Delhi → Mumbai is ~1,150 km straight-line: no safe-place route
    // is ever that long, and OSRM would answer with megabytes.
    const far = await fetch(`${base}/route?fromLat=28.6139&fromLng=77.209&toLat=19.076&toLng=72.8777`);
    assert.equal(far.status, 400);
    const body = await far.json();
    assert.equal(body.error, "Route distance exceeds 25 km");
    assert.equal(calls, 0);
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("route: HTTP leg — NoRoute upstream maps to 'No walking route found'", async () => {
  const restore = stubAxios(async () => ({ data: { code: "NoRoute", routes: [] } }));
  const app = express();
  app.use(routeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/route?fromLat=28.6139&fromLng=77.209&toLat=28.62&toLng=77.215`);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, "No walking route found");
  } finally {
    restore();
    await new Promise((resolve) => server.close(resolve));
  }
});
