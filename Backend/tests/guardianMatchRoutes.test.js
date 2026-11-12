// 🛰️ Guardian matching routes tests — SafeLife 2.0 Day 20 (plan §6 D20).
// Real Express app over HTTP (same pattern as guardianRoutes.test.js).
// Upstash is unconfigured, so matching runs on the in-memory path —
// the GEO logic itself is covered by guardianMatch.test.js with a
// fake transport. Every response is asserted to carry NO guardian
// coordinates: the nearby list reveals rounded distance only.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = ["d20", "match", "route", "secret"].join("-");
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
const guardianStore = require("../services/guardianStore");
const { issueCode } = require("../services/guardian");
const guardianMatch = require("../services/guardianMatch");

const KEY = "d20-match-route-secret";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";
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
beforeEach(() => {
  guardianStore._clearMemory();
  guardianMatch._locations.clear();
});

const post = (path, body, headers = HEADERS) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const get = (path, headers = HEADERS) =>
  fetch(`${base}${path}`, { headers }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

const register = (overrides = {}) =>
  post("/guardians", {
    userId: "user-1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    role: "family",
    ...overrides,
  });

// A verified guardian, optionally on duty — via the same seams the
// D19 tests use (issueCode in-process; the code never enters a response).
const verifiedGuardian = async ({ phone = "+919876543210", available = false } = {}) => {
  const { body } = await register({ phone });
  const guardian = await guardianStore.get(body.guardian.id);
  const { code } = issueCode(guardian);
  guardianStore.save(guardian);
  const verified = await post(`/guardians/${guardian.id}/verify`, { code });
  assert.equal(verified.status, 200);
  if (available) {
    const on = await post(`/guardians/${guardian.id}/availability`, { available: true });
    assert.equal(on.status, 200);
  }
  return guardian.id;
};

test("POST /guardians/:id/location: no key → 401; unknown id → 404", async () => {
  const id = await verifiedGuardian();
  const noKey = await post(
    `/guardians/${id}/location`,
    { lat: 28.6, lng: 77.2 },
    { "Content-Type": "application/json" }
  );
  assert.equal(noKey.status, 401);
  assert.equal((await post(`/guardians/${UNKNOWN}/location`, { lat: 28.6, lng: 77.2 })).status, 404);
});

test("POST /guardians/:id/location: pending guardian → 409 (verified-only)", async () => {
  const { body } = await register();
  const res = await post(`/guardians/${body.guardian.id}/location`, { lat: 28.6, lng: 77.2 });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /must be verified/);
});

test("POST /guardians/:id/location: bad coordinates → 400", async () => {
  const id = await verifiedGuardian();
  assert.equal((await post(`/guardians/${id}/location`, { lat: 91, lng: 77.2 })).status, 400);
  assert.equal((await post(`/guardians/${id}/location`, { lat: 28.6, lng: 200 })).status, 400);
  assert.equal((await post(`/guardians/${id}/location`, {})).status, 400);
  assert.equal((await post(`/guardians/${id}/location`, { lat: "x", lng: 77.2 })).status, 400);
});

test("POST /guardians/:id/location: verified → 200, public shape + updatedAt, no coordinates", async () => {
  const id = await verifiedGuardian();
  const res = await post(`/guardians/${id}/location`, { lat: 28.6, lng: 77.2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.guardian.id, id);
  assert.ok(res.body.locationUpdatedAt);
  // The pin itself never comes back in a response.
  assert.equal(JSON.stringify(res.body).includes("28.6"), false);
  assert.equal(JSON.stringify(res.body).includes("77.2"), false);
});

test("POST /guardians/:id/location: verified but off duty still records (toggle-on later uses it)", async () => {
  const id = await verifiedGuardian({ available: false });
  const res = await post(`/guardians/${id}/location`, { lat: 28.6, lng: 77.2 });
  assert.equal(res.status, 200);
});

test("GET /guardians/nearby: no key → 401; missing/bad coordinates → 400", async () => {
  const noKey = await get("/guardians/nearby?lat=28.6&lng=77.2", { "Content-Type": "application/json" });
  assert.equal(noKey.status, 401);
  assert.equal((await get("/guardians/nearby")).status, 400);
  assert.equal((await get("/guardians/nearby?lat=91&lng=77.2")).status, 400);
  assert.equal((await get("/guardians/nearby?lat=28.6&lng=200")).status, 400);
  assert.equal((await get("/guardians/nearby?lat=abc&lng=77.2")).status, 400);
});

test("GET /guardians/nearby: empty → 200 with defaults (radius 2 km, limit 10)", async () => {
  const res = await get("/guardians/nearby?lat=28.6&lng=77.2");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.guardians, []);
  assert.equal(res.body.radiusKm, 2);
  assert.equal(res.body.count, 0);
});

test("GET /guardians/nearby: nearest first with distanceKm + score, no coordinates", async () => {
  const near = await verifiedGuardian({ phone: "+919876543211", available: true });
  const far = await verifiedGuardian({ phone: "+919876543212", available: true });
  await post(`/guardians/${near}/location`, { lat: 28.601, lng: 77.201 });
  await post(`/guardians/${far}/location`, { lat: 28.61, lng: 77.21 });
  const res = await get("/guardians/nearby?lat=28.6&lng=77.2");
  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  assert.deepEqual(res.body.guardians.map((g) => g.id), [near, far]);
  const [first, second] = res.body.guardians;
  assert.ok(first.distanceKm < second.distanceKm);
  assert.ok(first.score > second.score);
  assert.equal(first.available, true);
  assert.equal(first.role, "family");
  // Privacy: no coordinates anywhere in the response.
  assert.equal(JSON.stringify(res.body).includes("28.601"), false);
  assert.equal(JSON.stringify(res.body).includes("77.201"), false);
  assert.ok(!("lat" in first) && !("lng" in first));
});

test("GET /guardians/nearby: pending and off-duty guardians never match", async () => {
  const pending = await register({ phone: "+919876543213" });
  // Pending: the location gate refuses (409), so no pin exists at all.
  assert.equal((await post(`/guardians/${pending.body.guardian.id}/location`, { lat: 28.6, lng: 77.2 })).status, 409);
  const offDuty = await verifiedGuardian({ phone: "+919876543214", available: false });
  await post(`/guardians/${offDuty}/location`, { lat: 28.6, lng: 77.2 });
  const res = await get("/guardians/nearby?lat=28.6&lng=77.2");
  assert.equal(res.body.count, 0);
});

test("GET /guardians/nearby: radius and limit clamp to their bounds", async () => {
  const wide = await get("/guardians/nearby?lat=28.6&lng=77.2&radiusKm=50");
  assert.equal(wide.body.radiusKm, 10);
  const narrow = await get("/guardians/nearby?lat=28.6&lng=77.2&radiusKm=0.1");
  assert.equal(narrow.body.radiusKm, 0.5);
  const many = await get("/guardians/nearby?lat=28.6&lng=77.2&limit=500");
  assert.equal(many.body.limit, 50);
});
