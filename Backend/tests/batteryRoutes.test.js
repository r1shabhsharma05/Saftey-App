// Battery-alert route tests — SafeLife 2.0 Day 11.
// Real Express app over HTTP (simulation-suite pattern). Every channel
// is unconfigured, so fan-out fails honestly and no real message can
// leave this process. The route must still 401/400 correctly, and a
// final burst must move a live alert's stored position even when the
// fan-out itself fails (the contacts-side page is the durable record).
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d11-route-secret";
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
const alertStore = require("../services/alertStore");
const { createAlert, transition } = require("../services/alertLifecycle");

const KEY = "d11-route-secret";

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

const postBattery = (body, key) =>
  fetch(`${base}/battery-alert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });

const validLow = {
  kind: "low",
  lat: 28.6139,
  lng: 77.209,
  battery: 15,
  name: "Test User",
  phone: "9999999999",
  contacts: [{ name: "Mom", phone: "8888888888" }],
};

test("battery-alert: no key → 401; wrong key → 401", async () => {
  assert.equal((await postBattery(validLow)).status, 401);
  assert.equal((await postBattery(validLow, "wrong-key")).status, 401);
});

test("battery-alert: bad coordinates / battery / kind → 400", async () => {
  assert.equal((await postBattery({ ...validLow, lat: 999 }, KEY)).status, 400);
  assert.equal((await postBattery({ ...validLow, battery: 16 }, KEY)).status, 400);
  assert.equal((await postBattery({ ...validLow, battery: 101 }, KEY)).status, 400);
  assert.equal((await postBattery({ ...validLow, battery: "low" }, KEY)).status, 400);
  assert.equal((await postBattery({ ...validLow, kind: "critical" }, KEY)).status, 400);
  assert.equal((await postBattery({ ...validLow, kind: "final", battery: 12 }, KEY)).status, 400);
});

test("battery-alert: all channels unconfigured → 502 with honest receipts, no fake success", async () => {
  const res = await postBattery(validLow, KEY);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.ok(Array.isArray(data.delivery));
  assert.equal(data.delivery.length, 4);
  assert.ok(data.delivery.every((r) => r.state === "failed"));
  assert.equal(data.viewUrl, null);
  // A battery warning is not an SOS: no escalation or retry is promised.
  assert.equal(data.escalation, undefined);
  assert.equal(data.retry, undefined);
});

test("battery-alert: final burst moves a live alert's stored position even when fan-out fails", async () => {
  const alert = createAlert({ contactsCount: 1, lat: 28.6, lng: 77.2 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  const res = await postBattery(
    { kind: "final", lat: 28.6139, lng: 77.209, battery: 5, alertId: alert.id },
    KEY
  );
  assert.equal(res.status, 502);
  const stored = await alertStore.get(alert.id);
  assert.equal(stored.lat, 28.6139);
  assert.equal(stored.lng, 77.209);
  assert.equal(stored.state, "delivered");
});

test("battery-alert: final burst with an unknown alert id still attempts fan-out, never crashes", async () => {
  const res = await postBattery(
    { kind: "final", lat: 28.6139, lng: 77.209, battery: 5, alertId: "00000000-0000-0000-0000-000000000000" },
    KEY
  );
  assert.equal(res.status, 502);
});
