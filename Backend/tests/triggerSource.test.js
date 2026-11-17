// 🧪 SOS trigger source — SafeLife 2.0 Day 25 (wake-word partial) +
// Day 28 shake trigger (swapped into D25 per amendment A7).
//
// POST /alert accepts an allowlisted `triggerSource` (button/voice/
// shake/duress), records it on the alert + the alert.created audit
// line, and exposes it on GET /alert/:id. An unknown or missing value
// defaults to "button" — a bad label must never 400 a real SOS.
//
// Runs the REAL Express app over HTTP with every channel
// unconfigured, so each SOS honestly answers 502 (failed state) and
// the assert is on the recorded source, not on delivery.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d25-trigger-secret";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_TEMPLATE_LANGUAGE",
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
const { setupJwtAuth, teardownJwtAuth, bearer } = require("./jwtAuth");
setupJwtAuth();

const SOS_BODY = {
  lat: 28.6139,
  lng: 77.209,
  name: "Trigger User",
  phone: "0000000000",
  battery: "42%",
  status: "Stationary",
  nearestStation: "Trigger Station",
  contacts: [],
};

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

const postSos = async (triggerSource) => {
  const body = { ...SOS_BODY };
  if (triggerSource !== undefined) body.triggerSource = triggerSource;
  const res = await fetch(`${base}/alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: bearer() },
    body: JSON.stringify(body),
  });
  return res;
};

const readSource = async (id) => {
  const res = await fetch(`${base}/alert/${id}`, { headers: { Authorization: bearer() } });
  assert.equal(res.status, 200, "alert must be readable by its owner");
  const data = await res.json();
  return data.alert.triggerSource;
};

test("voice triggerSource is recorded on the alert", async () => {
  const res = await postSos("voice");
  assert.equal(res.status, 502, "channels down → honest 502, not a fake success");
  const data = await res.json();
  assert.ok(data.alertId, "a failed alert still carries its id");
  assert.equal(await readSource(data.alertId), "voice");
});

test("shake triggerSource is recorded on the alert", async () => {
  const res = await postSos("shake");
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(await readSource(data.alertId), "shake");
});

test("unknown triggerSource defaults to button, never 400s the SOS", async () => {
  const res = await postSos("telepathy");
  assert.equal(res.status, 502, "a bad label must not block a real emergency");
  const data = await res.json();
  assert.equal(await readSource(data.alertId), "button");
});

test("missing triggerSource defaults to button", async () => {
  const res = await postSos(undefined);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(await readSource(data.alertId), "button");
});
