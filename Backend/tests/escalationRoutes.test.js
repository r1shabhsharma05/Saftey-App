// ACK + escalation-callback route tests — SafeLife 2.0 Day 10.
// Real Express app over HTTP (simulation-suite pattern). Every
// external dependency is unconfigured, so channel re-fires fail
// honestly and no real message or call can leave this process.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d10-route-secret";
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
const { escalationToken } = require("../services/escalation");
const { viewToken } = require("../services/alertView");

const KEY = "d10-route-secret";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";

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

const seedDelivered = () => {
  const alert = createAlert({ contactsCount: 2 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alert.delivery = [
    { channel: "telegram", state: "delivered", sent: 1, failed: 0, attempts: 1 },
    { channel: "sms", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
    { channel: "whatsapp", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
    { channel: "push", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
  ];
  alertStore.save(alert);
  return alert;
};

const ack = (id, body, { key, token } = {}) => {
  const q = token ? `?token=${token}` : "";
  return fetch(`${base}/alert/${id}/ack${q}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify(body || {}),
  });
};

test("ack: wrong token + wrong key → 401; unknown alert → 404", async () => {
  const alert = seedDelivered();
  const bad = await ack(alert.id, { phone: "+919999999999" }, { key: "wrong", token: "deadbeef" });
  assert.equal(bad.status, 401);
  const missing = await ack(UNKNOWN, {}, { key: KEY });
  assert.equal(missing.status, 404);
});

test("ack: view-token ack counts, dedupes, reaches threshold, closed → 410", async () => {
  const alert = seedDelivered();
  const token = viewToken(alert.id);
  const first = await ack(alert.id, { phone: "+919999999999" }, { token });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.state, "acked");
  assert.equal(firstBody.ackCount, 1);
  const dup = await ack(alert.id, { phone: "+91 99999 99999" }, { token });
  assert.equal((await dup.json()).ackCount, 1, "same number, different formatting = same ack");
  const second = await ack(alert.id, { phone: "+918888888888" }, { token });
  assert.equal((await second.json()).ackCount, 2);
  const read = await fetch(`${base}/alert/${alert.id}`, { headers: { "x-api-key": KEY } });
  const readBody = await read.json();
  assert.equal(readBody.alert.acks.length, 2);
  assert.ok(!JSON.stringify(readBody.alert.acks).includes("99999"), "no raw phone in stored acks");
  alert.state = "closed";
  alertStore.save(alert);
  const closed = await ack(alert.id, {}, { token });
  assert.equal(closed.status, 410);
});

test("ack: API-key path works, and the view-page form posts back to the page", async () => {
  const alert = seedDelivered();
  const viaKey = await ack(alert.id, { phone: "+917777777777" }, { key: KEY });
  assert.equal(viaKey.status, 200);
  assert.equal((await viaKey.json()).ackCount, 1);
  const page = await fetch(`${base}/alert/${alert.id}/view?token=${viewToken(alert.id)}`);
  const html = await page.text();
  assert.match(html, /confirm/i);
  assert.ok(html.includes(`/alert/${alert.id}/ack?token=`), "form posts to the ack route with the view token");
  const form = await fetch(`${base}/alert/${alert.id}/ack?token=${viewToken(alert.id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "contact=%2B916666666666",
    redirect: "manual",
  });
  assert.equal(form.status, 303);
  assert.ok(String(form.headers.get("location")).includes(`/alert/${alert.id}/view?token=`));
  const read = await fetch(`${base}/alert/${alert.id}`, { headers: { "x-api-key": KEY } });
  assert.equal((await read.json()).alert.acks.length, 2);
});

test("ack binding (H3): SOS stores contactKeys; only those contacts count, strangers 400, anonymous never counts", async () => {
  const { ackKeyFor } = require("../services/alertLifecycle");
  const sos = await fetch(`${base}/alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({
      lat: 28.6139,
      lng: 77.209,
      contacts: [
        { name: "Asha", phone: "+919999999999" },
        { name: "Ravi", phone: "+918888888888" },
      ],
    }),
  });
  assert.equal(sos.status, 502, "channels down: alert fails but is still created");
  const sosBody = await sos.json();
  const alert = await alertStore.get(sosBody.alertId);
  assert.equal(alert.contactKeys.length, 2);
  assert.deepEqual(
    [...alert.contactKeys].sort(),
    [ackKeyFor({ phone: "+919999999999" }), ackKeyFor({ phone: "+918888888888" })].sort()
  );
  // Failed → dispatching → delivered, so the ack route will accept acks.
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  const token = viewToken(alert.id);

  const stranger = await ack(alert.id, { phone: "+917777777777" }, { token });
  assert.equal(stranger.status, 400);
  assert.equal((await alertStore.get(alert.id)).acks.length, 0, "a rejected ack is not recorded");

  const anon = await ack(alert.id, {}, { token });
  assert.equal(anon.status, 200);
  const anonBody = await anon.json();
  assert.equal(anonBody.ackCount, 0, "anonymous ack never counts");
  assert.equal(anonBody.acked, false);
  assert.equal(anonBody.state, "delivered", "anonymous ack does not move delivered→acked");

  const first = await ack(alert.id, { phone: "+919999999999" }, { token });
  assert.equal((await first.json()).ackCount, 1);
  const second = await ack(alert.id, { phone: "+918888888888" }, { token });
  assert.equal((await second.json()).ackCount, 2);
});

test("escalate: forged token 401, bad step 400, unknown alert 404", async () => {
  const alert = seedDelivered();
  const forged = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alertId: alert.id, step: 1, token: "0".repeat(64), message: "SOS", contacts: [] }),
  });
  assert.equal(forged.status, 401);
  const badStep = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alertId: alert.id, step: 9, token: escalationToken(alert.id, 9), message: "SOS", contacts: [] }),
  });
  assert.equal(badStep.status, 400);
  const missing = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alertId: UNKNOWN, step: 1, token: escalationToken(UNKNOWN, 1), message: "SOS", contacts: [] }),
  });
  assert.equal(missing.status, 404);
});

test("escalate: step 1 refires failed channels and bumps attempts; duplicate step ignored; 2 acks stop it", async () => {
  const alert = seedDelivered();
  const run = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id, step: 1, token: escalationToken(alert.id, 1),
      message: "SOS", contacts: [{ phone: "+919999999999" }], pushTokens: [""],
    }),
  });
  assert.equal(run.status, 200);
  const runBody = await run.json();
  assert.equal(runBody.ignored, undefined);
  assert.equal(runBody.escalation.runs.length, 1);
  assert.equal(runBody.escalation.runs[0].step, 1);
  const sms = runBody.delivery.find((r) => r.channel === "sms");
  assert.equal(sms.attempts, 2, "escalation re-fire bumps the channel attempt count");
  assert.equal(runBody.delivery.find((r) => r.channel === "telegram").attempts, 1, "delivered channels are not re-fired");

  const dup = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id, step: 1, token: escalationToken(alert.id, 1),
      message: "SOS", contacts: [], pushTokens: [],
    }),
  });
  assert.equal((await dup.json()).ignored, true);

  // Two distinct acks stop the ladder: step 2 must not fire anything.
  await ack(alert.id, { phone: "+919999999999" }, { key: KEY });
  await ack(alert.id, { phone: "+918888888888" }, { key: KEY });
  const stopped = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id, step: 2, token: escalationToken(alert.id, 2),
      message: "SOS", contacts: [], pushTokens: [],
    }),
  });
  const stoppedBody = await stopped.json();
  assert.equal(stoppedBody.ignored, true);
  assert.equal(stoppedBody.ackCount, 2);
});

test("escalate: step 3 voice step records an honest unconfigured receipt, never throws", async () => {
  const alert = seedDelivered();
  const res = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id, step: 3, token: escalationToken(alert.id, 3),
      message: "SOS", contacts: ["+919999999999"], pushTokens: [""],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.escalation.runs.length, 1);
  assert.equal(body.escalation.runs[0].action, "voice-call");
  assert.equal(body.escalation.runs[0].voice.reason, "channel-not-configured");
  assert.equal(body.escalation.runs[0].voice.sent, 0);
});
