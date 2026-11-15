// 🔐 JWT-only enforcement tests (run-3 fix round 2, 1.1/2.1/3.1).
// A shared key alone must 401 on every mutating route — the fallback
// is deleted, not just deprecated. Real Express app over HTTP; JWTs
// are faked via the _setAuthTransport seam (see tests/jwtAuth.js).
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const { setupJwtAuth, teardownJwtAuth, bearer } = require("./jwtAuth");
setupJwtAuth();

process.env.API_SECRET = "jwt-only-test-secret";

let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  teardownJwtAuth();
  await new Promise((resolve) => server.close(resolve));
});

const KEY = { "x-api-key": "jwt-only-test-secret" };
const JWT = { "Content-Type": "application/json", Authorization: bearer() };

test("shared key alone → 401 on every mutating route (no fallback)", async () => {
  const cases = [
    ["POST", "/alert", { lat: 28.6, lng: 77.2 }],
    ["POST", "/battery-alert", { kind: "low", lat: 28.6, lng: 77.2, battery: 15 }],
    ["POST", "/location-update", { lat: 28.6, lng: 77.2 }],
    ["POST", "/guardians", { name: "N", phone: "+919876543210", role: "family" }],
    ["POST", "/journeys", { originLat: 28.6, originLng: 77.2, destLat: 28.7, destLng: 77.3, destinationLabel: "Home", expectedArrivalAt: new Date(Date.now() + 3600000).toISOString() }],
    ["POST", "/voice/synthesize", { text: "SOS" }],
    // NOTE: /test-alert is NOT in this list — its testAlertGate
    // answers 404 before auth when ENABLE_TEST_ALERT is unset.
  ];
  for (const [method, path, body] of cases) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...KEY },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401, `${method} ${path} with shared key alone must 401`);
  }
  // ...and on reads too.
  for (const path of ["/alert/00000000-0000-0000-0000-000000000000", "/guardian/00000000-0000-0000-0000-000000000000", "/journey/00000000-0000-0000-0000-000000000000"]) {
    const res = await fetch(`${base}${path}`, { headers: KEY });
    assert.equal(res.status, 401, `GET ${path} with shared key alone must 401`);
  }
});

test("shared key + valid JWT → JWT wins (key ignored); no JWT at all → 401", async () => {
  const withBoth = await fetch(`${base}/guardians`, {
    method: "POST",
    headers: { ...JWT, ...KEY },
    body: JSON.stringify({ name: "N", phone: "+919876543211", role: "family" }),
  });
  assert.equal(withBoth.status, 200);
  const noAuth = await fetch(`${base}/guardians`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N", phone: "+919876543212", role: "family" }),
  });
  assert.equal(noAuth.status, 401);
});

test("public routes stay ungated (/, /health, /safe-places, /police/nearest, /route)", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  // The proxies need no auth to answer (they may 502 upstream — the
  // point is they are NOT 401).
  for (const path of ["/safe-places?lat=28.6&lng=77.2", "/police/nearest?lat=28.6&lng=77.2"]) {
    const res = await fetch(`${base}${path}`);
    assert.notEqual(res.status, 401, `${path} must not require auth`);
  }
});

test("QStash callbacks stay HMAC-authenticated, NOT JWT-gated (forged token → 401, no JWT needed)", async () => {
  // A forged HMAC token is 401 without any JWT — the callback auth
  // is unchanged by the JWT-only switch.
  const res = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alertId: "00000000-0000-0000-0000-000000000000", step: 1, token: "deadbeef" }),
  });
  assert.equal(res.status, 401);
});
