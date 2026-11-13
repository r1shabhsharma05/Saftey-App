// 🛡️ Guardian alert flow routes tests — SafeLife 2.0 Day 21 (plan §6 D21).
// Real Express app over HTTP (same pattern as guardianMatchRoutes.test.js).
// SMS is unconfigured here (env scrubbed), so the SOS-time notify
// honestly fails with channel-not-configured — the response record
// still exists, and the accept/decline/tracking/message flow is
// exercised end-to-end over HTTP. The successful-SMS path is covered
// by guardianAlert.test.js with a fake sender.
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

test("POST /alert notifies a nearby guardian (honest SMS failure) and records the response", async () => {
  const { alertId, guardianId, sos } = await sosWithGuardian();
  assert.deepEqual(sos.body.guardians, { notified: 0, failed: 1, reason: "channel-not-configured" });
  const res = await get(`/alert/${alertId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.alert.guardians.notified, 1);
  assert.equal(res.body.alert.guardians.accepted, 0);
  const [response] = res.body.alert.guardians.responses;
  assert.equal(response.guardianId, guardianId);
  assert.equal(response.state, "notified");
  assert.equal(response.distanceKm, 0.1);
  assert.ok(response.score > 0);
});

test("POST /alert with no guardian nearby reports no-guardians-nearby", async () => {
  const sos = await post("/alert", { ...SOS_AT, name: "Test User", phone: "+919999999999", contacts: [] });
  assert.equal(sos.status, 502);
  assert.deepEqual(sos.body.guardians, { notified: 0, failed: 0, reason: "no-guardians-nearby" });
  const res = await get(`/alert/${sos.body.alertId}`);
  assert.equal(res.body.alert.guardians.notified, 0);
});

test("accept: no key → 401; unknown alert/guardian/not-notified → 404", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const noKey = await post(
    `/alert/${alertId}/guardian/${guardianId}/accept`,
    {},
    { "Content-Type": "application/json" }
  );
  assert.equal(noKey.status, 401);
  assert.equal((await post(`/alert/${UNKNOWN}/guardian/${guardianId}/accept`, {})).status, 404);
  assert.equal((await post(`/alert/${alertId}/guardian/${UNKNOWN}/accept`, {})).status, 404);
  const stranger = await verifiedGuardian({ phone: "+919876543219", available: true });
  assert.equal((await post(`/alert/${alertId}/guardian/${stranger}/accept`, {})).status, 404);
});

test("accept: 200, victim read shows accepted; repeat accept is an idempotent 200", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const res = await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.state, "accepted");
  assert.equal(res.body.already, false);
  const read = await get(`/alert/${alertId}`);
  assert.equal(read.body.alert.guardians.accepted, 1);
  assert.equal(read.body.alert.guardians.responses[0].state, "accepted");
  assert.ok(read.body.alert.guardians.responses[0].respondedAt);
  const repeat = await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {});
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.already, true);
});

test("decline: 200, then accept → 409; repeat decline is an idempotent 200", async () => {
  const { alertId, guardianId } = await sosWithGuardian();
  const res = await post(`/alert/${alertId}/guardian/${guardianId}/decline`, {});
  assert.equal(res.status, 200);
  assert.equal(res.body.state, "declined");
  assert.equal((await post(`/alert/${alertId}/guardian/${guardianId}/accept`, {})).status, 409);
  const repeat = await post(`/alert/${alertId}/guardian/${guardianId}/decline`, {});
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.already, true);
});

test("accept on a closed alert → 410; on an expired response → 409", async () => {
  const guardianId = await verifiedGuardian({ available: true });
  const closedId = await deliveredAlertWithGuardian(guardianId);
  const closed = await post(`/alert/${closedId}/close`, {});
  assert.equal(closed.status, 200);
  assert.equal((await post(`/alert/${closedId}/guardian/${guardianId}/accept`, {})).status, 410);
  const staleId = await deliveredAlertWithGuardian(guardianId, Date.now() - 16 * 60 * 1000);
  const stale = await post(`/alert/${staleId}/guardian/${guardianId}/accept`, {});
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /expired/);
});
