// 🛡️ Guardian alert flow (live tracking, messages, guardian list, view page) —
// SafeLife 2.0 Day 21 (plan §6 D21). Companion to guardianAlertRoutes.test.js
// (SOS notify + accept/decline); split so one file stays under the 60/min
// tracking-limiter budget — each file boots its own server.
// Real Express app over HTTP; SMS is unconfigured (env scrubbed).
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = ["d21", "alert", "route", "secret"].join("-");
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
const alertStore = require("../services/alertStore");
const { issueCode } = require("../services/guardian");
const guardianMatch = require("../services/guardianMatch");
const { createAlert, transition } = require("../services/alertLifecycle");
const { recordNotification, newGuardianAlertState } = require("../services/guardianAlert");
const { viewToken } = require("../services/alertView");

const KEY = "d21-alert-route-secret";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const HEADERS = { "Content-Type": "application/json", "x-api-key": KEY };
const SOS_AT = { lat: 28.6139, lng: 77.209 };
const GUARDIAN_AT = { lat: 28.614, lng: 77.2095 };

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
  alertStore._clearMemory();
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

const getHtml = (path, headers = HEADERS) =>
  fetch(`${base}${path}`, { headers }).then(async (r) => ({
    status: r.status,
    text: await r.text().catch(() => ""),
  }));

const register = (overrides = {}) =>
  post("/guardians", {
    userId: "user-1",
    name: "Asha",
    phone: "+919876543210",
    role: "family",
    ...overrides,
  });

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

// An SOS fired next to a verified on-duty guardian with a fresh pin.
// All contact channels are down in this env, so the SOS answers 502
// — but the guardian notify still runs on the failed path.
const sosWithGuardian = async () => {
  const guardianId = await verifiedGuardian({ available: true });
  const located = await post(`/guardians/${guardianId}/location`, GUARDIAN_AT);
  assert.equal(located.status, 200);
  const sos = await post("/alert", { ...SOS_AT, name: "Test User", phone: "+919999999999", contacts: [] });
  assert.equal(sos.status, 502);
  assert.ok(sos.body.alertId);
  return { alertId: sos.body.alertId, guardianId, sos };
};

// A delivered alert built via the service seam (no channels needed):
// the closed/expired branches need a live alert the 502 path cannot make.
const deliveredAlertWithGuardian = async (guardianId, notifiedAtMs = Date.now()) => {
  const alert = createAlert({ contactsCount: 0, lat: SOS_AT.lat, lng: SOS_AT.lng });
  alert.guardians = newGuardianAlertState();
  recordNotification(alert.guardians, {
    guardianId,
    name: "Asha",
    role: "family",
    distanceKm: 0.1,
    score: 0.9,
    nowMs: notifiedAtMs,
  });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  return alert.id;
};

test("guardian location: not-accepted → 409; bad coords → 400; accepted → 200 and the victim read shows the pin", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  assert.equal(
    (await post(`/alert/${alertId}/guardian/${guardianId}/location`, { lat: 28.61, lng: 77.21 })).status,
    409
  );
  await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {});
  assert.equal(
    (await post(`/alert/${alertId}/guardian/${guardianId}/location`, { lat: 91, lng: 77.2 })).status,
    400
  );
  const res = await post(`/alert/${alertId}/guardian/${guardianId}/location`, { lat: 28.612, lng: 77.208 });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.distanceKm, 0.2);
  const read = await get(`/alert/${alertId}`);
  assert.equal(read.body.alert.guardians.locations.length, 1);
  assert.equal(read.body.alert.guardians.locations[0].lat, 28.612);
  assert.equal(read.body.alert.guardians.locations[0].distanceKm, 0.2);
});

test("messages: victim + accepted guardian exchange presets; unknown key, cross-role key and unaccepted guardian → 400/409", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const v = await post(`/alert/${alertId}/message`, { sender: "victim", key: "please-hurry" });
  assert.equal(v.status, 200);
  assert.equal(v.body.message.text, "Please hurry");
  assert.equal((await post(`/alert/${alertId}/message`, { sender: "victim", key: "on-my-way" })).status, 400);
  assert.equal((await post(`/alert/${alertId}/message`, { sender: "victim", key: "nope" })).status, 400);
  assert.equal((await post(`/alert/${alertId}/message`, { sender: "someone", key: "please-hurry" })).status, 400);
  assert.equal(
    (await post(`/alert/${alertId}/message`, { sender: "guardian", guardianId, key: "on-my-way" })).status,
    409
  );
  await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {});
  const g = await post(`/alert/${alertId}/message`, { sender: "guardian", guardianId, key: "on-my-way" });
  assert.equal(g.status, 200);
  assert.equal(g.body.message.text, "I'm on my way to you");
  const read = await get(`/alert/${alertId}`);
  assert.deepEqual(
    read.body.alert.guardians.messages.map((m) => [m.from, m.key]),
    [
      ["victim", "please-hurry"],
      [guardianId, "on-my-way"],
    ]
  );
  assert.equal(read.body.alert.guardians.messages[1].name, "Asha");
});

test("GET /guardians/:id/alerts: no key → 401; unknown → 404; lists the live alert with the victim pin", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const noKey = await get(`/guardians/${guardianId}/alerts`, { "Content-Type": "application/json" });
  assert.equal(noKey.status, 401);
  assert.equal((await get(`/guardians/${UNKNOWN}/alerts`)).status, 404);
  const res = await get(`/guardians/${guardianId}/alerts`);
  assert.equal(res.status, 200);
  assert.equal(res.body.alerts.length, 1);
  const [item] = res.body.alerts;
  assert.equal(item.alertId, alertId);
  assert.equal(item.state, "failed");
  assert.equal(item.lat, SOS_AT.lat);
  assert.equal(item.lng, SOS_AT.lng);
  assert.equal(item.responseState, "notified");
  assert.equal(item.distanceKm, 0.1);
  assert.deepEqual(item.messages, []);
  // A closed alert leaves the list.
  const closedId = await deliveredAlertWithGuardian(guardianId);
  await post(`/alert/${closedId}/close`, {});
  const after = await get(`/guardians/${guardianId}/alerts`);
  assert.equal(after.body.alerts.length, 1);
  assert.equal(after.body.alerts[0].alertId, alertId);
});

test("contacts view page: guardian line shows counts + nearest distance, never guardian coordinates", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const token = viewToken(alertId);
  const before = await getHtml(`/alert/${alertId}/view?token=${token}`);
  assert.equal(before.status, 200);
  assert.match(before.text, /1 guardian notified/);
  await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {});
  await post(`/alert/${alertId}/guardian/${guardianId}/location`, { lat: 28.612, lng: 77.208 });
  const after = await getHtml(`/alert/${alertId}/view?token=${token}`);
  assert.equal(after.status, 200);
  assert.match(after.text, /1 on the way/);
  assert.match(after.text, /0\.2 km away/);
  // The guardian's own pin must never appear on the contacts page.
  assert.equal(after.text.includes("28.612"), false);
  assert.equal(after.text.includes("77.208"), false);
});
