// Journey Guardian route tests — SafeLife 2.0 Day 16 (plan §6 D16).
// Real Express app over HTTP (simulation-suite pattern). Every external
// dependency is unconfigured, so no message can leave this process;
// the journey flow needs no channel at all — creation only returns a
// share link, the user sends it. API key enforced (API_SECRET set
// below), so the 401 paths are exercised for real.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d16-route-secret";
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
const { journeyToken } = require("../services/journeyView");

const KEY = "d16-route-secret";
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
beforeEach(() => journeyStore._clearMemory());

const post = (path, body, headers = HEADERS) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (path, headers = HEADERS) => fetch(`${base}${path}`, { headers });

const createBody = () => ({
  originLat: 28.6139,
  originLng: 77.209,
  destLat: 28.62,
  destLng: 77.215,
  destinationLabel: "Connaught Place",
  expectedArrivalAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  userName: "Rishabh Sharma",
});

const createJourney = async () => {
  const res = await post("/journeys", createBody());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  return data.journey;
};

test("POST /journeys: creates an active journey and returns the share link shape", async () => {
  const res = await post("/journeys", createBody());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.journey.state, "active");
  assert.equal(data.journey.destination.label, "Connaught Place");
  assert.equal(data.journey.overdue, false);
  // No PUBLIC_BASE_URL in this process: no link is invented.
  assert.equal(data.viewUrl, null);
  const stored = await journeyStore.get(data.journey.id);
  assert.equal(stored.state, "active");
});

test("POST /journeys: PUBLIC_BASE_URL set → viewUrl carries a signed token", async () => {
  process.env.PUBLIC_BASE_URL = "https://example.invalid";
  try {
    const res = await post("/journeys", createBody());
    const data = await res.json();
    assert.match(data.viewUrl, /^https:\/\/example\.invalid\/journey\/[0-9a-f-]+\/view\?token=[0-9a-f]{64}$/);
  } finally {
    delete process.env.PUBLIC_BASE_URL;
  }
});

test("POST /journeys: bad coordinates, label, or ETA are 400", async () => {
  for (const bad of [
    { ...createBody(), originLat: 91 },
    { ...createBody(), destLng: "x" },
    { ...createBody(), destinationLabel: "  " },
    { ...createBody(), expectedArrivalAt: "yesterday" },
    { ...createBody(), expectedArrivalAt: new Date(Date.now() - 60000).toISOString() },
    { ...createBody(), expectedArrivalAt: new Date(Date.now() + 13 * 60 * 60 * 1000).toISOString() },
  ]) {
    const res = await post("/journeys", bad);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
  }
});

test("POST /journeys: no API key is 401", async () => {
  const res = await post("/journeys", createBody(), { "Content-Type": "application/json" });
  assert.equal(res.status, 401);
});

test("GET /journey/:id: owner read returns the journey; unknown is 404", async () => {
  const j = await createJourney();
  const res = await get(`/journey/${j.id}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.journey.id, j.id);
  assert.equal(data.journey.state, "active");

  assert.equal((await get(`/journey/${UNKNOWN}`)).status, 404);
  assert.equal((await get(`/journey/${j.id}`, {})).status, 401);
});

test("POST /journey/:id/location: moves the pin; bad coords 400; finished journey 409", async () => {
  const j = await createJourney();
  const res = await post(`/journey/${j.id}/location`, { lat: 28.615, lng: 77.211 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.journey.lat, 28.615);
  assert.equal(data.journey.lng, 77.211);

  assert.equal((await post(`/journey/${j.id}/location`, { lat: 999, lng: 77.211 })).status, 400);
  assert.equal((await post(`/journey/${UNKNOWN}/location`, { lat: 28.615, lng: 77.211 })).status, 404);

  await post(`/journey/${j.id}/arrived`, {});
  assert.equal((await post(`/journey/${j.id}/location`, { lat: 28.616, lng: 77.212 })).status, 409);
});

test("POST /journey/:id/arrived: active → arrived; second call 409; unknown 404", async () => {
  const j = await createJourney();
  const res = await post(`/journey/${j.id}/arrived`, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).journey.state, "arrived");
  assert.equal((await post(`/journey/${j.id}/arrived`, {})).status, 409);
  assert.equal((await post(`/journey/${UNKNOWN}/arrived`, {})).status, 404);
});

test("POST /journey/:id/cancel: active → cancelled; after arrival 409", async () => {
  const j = await createJourney();
  const res = await post(`/journey/${j.id}/cancel`, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).journey.state, "cancelled");

  const arrived = await createJourney();
  await post(`/journey/${arrived.id}/arrived`, {});
  assert.equal((await post(`/journey/${arrived.id}/cancel`, {})).status, 409);
});

test("GET /journey/:id/view: token-gated HTML page with destination and live pin", async () => {
  const j = await createJourney();
  const token = journeyToken(j.id);
  await post(`/journey/${j.id}/location`, { lat: 28.615, lng: 77.211 });

  const noToken = await get(`/journey/${j.id}/view`, {});
  assert.equal(noToken.status, 401);
  const wrongToken = await get(`/journey/${j.id}/view?token=${"0".repeat(64)}`, {});
  assert.equal(wrongToken.status, 401);
  const unknown = await get(`/journey/${UNKNOWN}/view?token=${journeyToken(UNKNOWN)}`, {});
  assert.equal(unknown.status, 404);

  const res = await get(`/journey/${j.id}/view?token=${token}`, {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const html = await res.text();
  assert.match(html, /Connaught Place/);
  assert.match(html, /active/);
  assert.match(html, /28\.615, 77\.211/);
  // The token lives in the page URL: Referrer-Policy is a header,
  // not body text — a link click must not leak it to Google/OSM.
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});

test("GET /journey/:id/view: a cancelled journey is 410 (stale pin, not a live trip)", async () => {
  const j = await createJourney();
  await post(`/journey/${j.id}/cancel`, {});
  const res = await get(`/journey/${j.id}/view?token=${journeyToken(j.id)}`, {});
  assert.equal(res.status, 410);
});

test("GET /journey/:id/location: token-gated JSON twin of the view page", async () => {
  const j = await createJourney();
  const token = journeyToken(j.id);
  assert.equal((await get(`/journey/${j.id}/location`, {})).status, 401);
  const res = await get(`/journey/${j.id}/location?token=${token}`, {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.journeyId, j.id);
  assert.equal(data.state, "active");
  assert.equal(data.lat, 28.6139);
  assert.equal(data.overdue, false);
});

test("POST /journeys (M7): full store of live trips → 503, no live trip evicted", async () => {
  const { createJourney } = require("../services/journey");
  const inMinutes = (m) => new Date(Date.now() + m * 60 * 1000).toISOString();
  const first = createJourney({
    originLat: 28.6139, originLng: 77.209, destLat: 28.62, destLng: 77.215,
    destinationLabel: "First live", expectedArrivalAt: inMinutes(25), userName: "Rishabh Sharma",
  });
  journeyStore.save(first);
  for (let i = 0; i < 499; i++) {
    journeyStore.save(createJourney({
      originLat: 28.6139, originLng: 77.209, destLat: 28.62, destLng: 77.215,
      destinationLabel: `J${i}`, expectedArrivalAt: inMinutes(25), userName: "Rishabh Sharma",
    }));
  }
  assert.equal(journeyStore._size(), 500);
  const res = await post("/journeys", createBody());
  assert.equal(res.status, 503);
  assert.equal(journeyStore._size(), 500);
  assert.equal(journeyStore._has(first.id), true, "no live trip was evicted to make room");
});
