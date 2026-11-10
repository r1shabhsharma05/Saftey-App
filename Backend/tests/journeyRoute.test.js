// 🧭 Journey route tests — SafeLife 2.0 Day 18 (Phase 3 test day).
//
// The D17 watch measured deviation against the STRAIGHT origin→
// destination line. The Day-18 real-area probe showed that fails on
// a real road: the live OSRM walking route GLA University → Mathura
// Junction (18.2 km, 483 vertices, probed 2026-11-10 from the live
// /route endpoint) wanders up to 3,073 m off the straight line, and
// 411 of its 483 vertices sit >500 m off it — a traveller walking
// the real road would be flagged "deviated" for 85% of the trip.
// (Short urban trips are fine: CP → NDLS maxes at 158 m, the D14
// fixture at 360 m — which is why the synthetic tests never caught
// this.) These tests pin the fix: when the app sends the OSRM
// polyline at create time, deviation is measured against the
// polyline; without one, the D17 straight-line behaviour stands.
//
// Fixture: tests/fixtures/gla-mathura-route.json — the 483 [lng, lat]
// pairs from that live probe, endpoints hand-checked against the
// journey origin/destination in journeyWatch.test.js.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createJourney, setJourneyLocation, normalizeRoute, MAX_ROUTE_POINTS } = require("../services/journey");
const {
  deviationM,
  isDeviated,
} = require("../services/journeyWatch");

const ORIGIN = { lat: 27.6057, lng: 77.5933 };
const DEST = { lat: 27.4924, lng: 77.6737 };
// Worst straight-line vertex of the real route (measured live:
// 3,073 m off the straight line, on the road itself).
const BEND = { lat: 27.569008, lng: 77.656159 };

const fixtureLngLat = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "gla-mathura-route.json"), "utf8")
);
const ROUTE = fixtureLngLat.map(([lng, lat]) => ({ lat, lng }));

const makeJourney = (route) =>
  createJourney({
    originLat: ORIGIN.lat,
    originLng: ORIGIN.lng,
    destLat: DEST.lat,
    destLng: DEST.lng,
    destinationLabel: "Mathura Junction",
    expectedArrivalAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    userName: "Test Traveller",
    ...(route !== undefined ? { route } : {}),
  });

test("fixture is the real GLA→Mathura route: 483 points, endpoints match", () => {
  assert.equal(fixtureLngLat.length, 483);
  assert.deepEqual(fixtureLngLat[0], [77.5935, 27.605451]);
  assert.deepEqual(fixtureLngLat[482], [77.673684, 27.492385]);
  assert.ok(Math.abs(ROUTE[0].lat - ORIGIN.lat) < 0.001);
  assert.ok(Math.abs(ROUTE[482].lat - DEST.lat) < 0.001);
});

test("the bend vertex is 3,073 m off the straight line — the D17 false positive", () => {
  const j = makeJourney();
  setJourneyLocation(j, BEND.lat, BEND.lng);
  const d = deviationM(j);
  assert.ok(d > 3000 && d < 3150, `bend vertex must read ~3,073 m straight-line, got ${d}`);
  assert.equal(isDeviated(j), true);
});

test("with the polyline, every real-road vertex reads ~0 (no false prompt)", () => {
  const j = makeJourney(ROUTE);
  let max = 0;
  for (const p of ROUTE) {
    setJourneyLocation(j, p.lat, p.lng);
    const d = deviationM(j);
    if (d > max) max = d;
  }
  assert.ok(max < 50, `worst on-polyline pin must read <50 m, got ${max}`);
  setJourneyLocation(j, BEND.lat, BEND.lng);
  assert.ok(deviationM(j) < 5, `bend vertex must read ~0 with the polyline, got ${deviationM(j)}`);
  assert.equal(isDeviated(j), false);
});

test("with the polyline, a pin 880 m east of the bend trips; 190 m does not", () => {
  const j = makeJourney(ROUTE);
  // Offsets hand-checked against the polyline with an independent
  // point-to-segment calculation (not this module): +0.009° lng ≈
  // 877 m, +0.002° lng ≈ 188 m.
  setJourneyLocation(j, BEND.lat, BEND.lng + 0.009);
  const far = deviationM(j);
  assert.ok(far > 800 && far < 950, `+0.009° lng must read ~877 m, got ${far}`);
  assert.equal(isDeviated(j), true);
  setJourneyLocation(j, BEND.lat, BEND.lng + 0.002);
  const near = deviationM(j);
  assert.ok(near > 150 && near < 250, `+0.002° lng must read ~188 m, got ${near}`);
  assert.equal(isDeviated(j), false);
});

test("without a route the straight-line measure stands (old records keep working)", () => {
  const j = makeJourney();
  setJourneyLocation(j, BEND.lat, BEND.lng);
  assert.equal(isDeviated(j), true);
  // An empty or single-point route cannot define a path: same fallback.
  const empty = makeJourney([]);
  setJourneyLocation(empty, BEND.lat, BEND.lng);
  assert.equal(isDeviated(empty), true);
});

test("normalizeRoute drops garbage points and caps at MAX_ROUTE_POINTS", () => {
  assert.deepEqual(normalizeRoute(undefined), []);
  assert.deepEqual(normalizeRoute("nope"), []);
  assert.deepEqual(normalizeRoute([{ lat: 27.6, lng: 77.59 }]), [{ lat: 27.6, lng: 77.59 }]);
  assert.deepEqual(
    normalizeRoute([
      { lat: 27.6, lng: 77.59 },
      { lat: 999, lng: 77.59 },
      { lat: 27.6, lng: "x" },
      null,
      [77.59, 27.6],
    ]),
    [{ lat: 27.6, lng: 77.59 }],
    "only {lat,lng} objects with finite in-range coords survive"
  );
  const long = Array.from({ length: MAX_ROUTE_POINTS + 50 }, (_, i) => ({
    lat: 27.6 + i * 0.00001,
    lng: 77.59,
  }));
  assert.equal(normalizeRoute(long).length, MAX_ROUTE_POINTS);
  assert.equal(MAX_ROUTE_POINTS, 1000);
});

test("createJourney stores the normalized route on the record", () => {
  const j = makeJourney(ROUTE);
  assert.equal(j.route.length, 483);
  assert.deepEqual(j.route[0], ROUTE[0]);
  assert.deepEqual(makeJourney().route, []);
});

// ── HTTP leg: the route rides POST /journeys and drives the watch ──
process.env.API_SECRET = "d18-route-secret";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
  "BOLNA_API_KEY",
  "BOLNA_AGENT_ID",
  "QSTASH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "PUBLIC_BASE_URL",
  "VERCEL_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  delete process.env[v];
}

const app = require("../server");
const journeyStore = require("../services/journeyStore");

const KEY = "d18-route-secret";
const HEADERS = { "Content-Type": "application/json", "x-api-key": KEY };

let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => journeyStore._clearMemory());

const post = (path, body, headers = HEADERS) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const createBody = (route) => ({
  originLat: ORIGIN.lat,
  originLng: ORIGIN.lng,
  destLat: DEST.lat,
  destLng: DEST.lng,
  destinationLabel: "Mathura Junction",
  expectedArrivalAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  userName: "Test Traveller",
  ...(route !== undefined ? { route } : {}),
});

test("POST /journeys: route stored; bend pin reads ok with it, deviated without it", async () => {
  const withRoute = await post("/journeys", createBody(ROUTE));
  assert.equal(withRoute.status, 200);
  const withData = await withRoute.json();
  assert.equal(withData.success, true);
  const stored = await journeyStore.get(withData.journey.id);
  assert.equal(stored.route.length, 483);

  const loc = await post(`/journey/${withData.journey.id}/location`, {
    lat: BEND.lat,
    lng: BEND.lng,
  });
  assert.equal(loc.status, 200);
  const locBody = await loc.json();
  assert.equal(locBody.journey.watch.status, "ok");
  assert.ok(locBody.journey.watch.deviationM < 50, `bend pin with route must read <50 m, got ${locBody.journey.watch.deviationM}`);
  assert.equal(locBody.journey.checkIn, null, "no check-in asked on the real road");

  const noRoute = await post("/journeys", createBody());
  assert.equal(noRoute.status, 200);
  const noData = await noRoute.json();
  const loc2 = await post(`/journey/${noData.journey.id}/location`, {
    lat: BEND.lat,
    lng: BEND.lng,
  });
  assert.equal(loc2.status, 200);
  const loc2Body = await loc2.json();
  assert.equal(loc2Body.journey.watch.status, "deviated");
  assert.ok(loc2Body.journey.watch.deviationM > 3000);
  assert.equal(loc2Body.journey.checkIn.reason, "deviated");
});

test("POST /journeys: a non-array route is 400, not silently dropped", async () => {
  const res = await post("/journeys", createBody("not-a-route"));
  assert.equal(res.status, 400);
});
