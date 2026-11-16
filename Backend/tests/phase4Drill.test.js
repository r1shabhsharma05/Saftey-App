// 🛡️ Phase 4 drill — SafeLife 2.0 Day 24 (plan §6 D24, A6 simulation).
//
// The live 3-device drill (victim + guardian + contact phones) moves to
// the Day-30 release checklist (A6); this file is the simulation drill:
// one continuous story over the REAL Express app over HTTP, with every
// external channel unconfigured (no Telegram, SMS, WhatsApp, FCM, QStash,
// Upstash, Supabase, public URL) — so every "delivery failed" below is
// the honest pre-blocker state, never a mocked success.
//
// The drill, in order (tests share one booted server on purpose — it is
// a single drill, not isolated units):
//   1. Victim onboards guardian Asha: register → verify → on duty → pin.
//   2. Victim SOS next to Asha: 502 honest delivery failure, guardian notified.
//   3. Asha accepts, posts live location; the victim read shows her pin moving.
//   4. Victim + guardian exchange preset messages.
//   5. Contact view page: guardian line (counts + distance), never her coords.
//   6. Police layer: nearest station + 112 (Overpass stubbed, no network).
//   7. One false alarm mid-drill does NOT block the real SOS (D23's promise).
//   8. Three false alarms DO block SOS 403 (D23 gate, end of drill only).
//   9. Resolved close ends a delivered alert; its view page goes 410.
//
// Env is pinned at the top, BEFORE requiring the app (same as D21 files).
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

process.env.API_SECRET = "d24-drill-secret";
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
const { setupJwtAuth, teardownJwtAuth, bearer } = require("./jwtAuth");
setupJwtAuth();
const guardianStore = require("../services/guardianStore");
const alertStore = require("../services/alertStore");
const { issueCode } = require("../services/guardian");
const guardianMatch = require("../services/guardianMatch");
const { createAlert, transition } = require("../services/alertLifecycle");
const { recordNotification, newGuardianAlertState } = require("../services/guardianAlert");
const { viewToken } = require("../services/alertView");
const strikes = require("../services/strikes");
const { _setWriteSink } = require("../services/audit");

const KEY = "test-token";
const HEADERS = { "Content-Type": "application/json", Authorization: bearer() };
const IP_ACTOR = "ip:127.0.0.1";
const SOS_AT = { lat: 28.6139, lng: 77.209 };
const GUARDIAN_AT = { lat: 28.614, lng: 77.2095 };
const SOS_BODY = {
  ...SOS_AT,
  name: "Drill Victim",
  phone: "+919999999999",
  contacts: [{ name: "Mom", phone: "8888888888" }],
};

let server;
let base;
let auditLines = [];
let guardianId;
let drillAlertId;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  _setWriteSink((line) => auditLines.push(line));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
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

const sos = () => post("/alert", SOS_BODY);

// A delivered alert with Asha notified (service seam — the 502 path can
// never make one, same as D23's seedDelivered). Closes are the real HTTP
// path; the seam only builds the fixture.
const seedDeliveredWithGuardian = () => {
  const alert = createAlert({ contactsCount: 0, lat: SOS_AT.lat, lng: SOS_AT.lng, ownerId: "test-user" });
  alert.guardians = newGuardianAlertState();
  recordNotification(alert.guardians, {
    guardianId,
    name: "Asha",
    role: "family",
    distanceKm: 0.1,
    score: 0.9,
    nowMs: Date.now(),
  });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  return alert;
};

test("drill 1 — victim onboards guardian Asha: register → verify → on duty → pin", async () => {
  const reg = await post("/guardians", {
    userId: "user-1",
    name: "Asha",
    phone: "+919876543210",
    role: "family",
  });
  assert.equal(reg.status, 200);
  guardianId = reg.body.guardian.id;
  assert.ok(guardianId);

  const guardian = await guardianStore.get(guardianId);
  const { code } = issueCode(guardian);
  guardianStore.save(guardian);
  assert.equal((await post(`/guardians/${guardianId}/verify`, { code })).status, 200);
  assert.equal((await post(`/guardians/${guardianId}/availability`, { available: true })).status, 200);
  assert.equal((await post(`/guardians/${guardianId}/location`, GUARDIAN_AT)).status, 200);

  const read = await get(`/guardian/${guardianId}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.guardian.state, "verified");
  assert.equal(read.body.guardian.available, true);
});

test("drill 2 — victim SOS: honest 502, guardian notified, contact receipts failed", async () => {
  const res = await sos();
  assert.equal(res.status, 502);
  drillAlertId = res.body.alertId;
  assert.ok(drillAlertId);
  assert.equal(res.body.state, "failed");
  assert.deepEqual(
    res.body.delivery.map((r) => r.channel),
    ["telegram", "sms", "whatsapp", "push"]
  );
  for (const receipt of res.body.delivery) assert.equal(receipt.state, "failed");
  // The guardian notify runs even on the failed path — SMS unconfigured,
  // so the send fails honestly, but the response record exists.
  assert.deepEqual(res.body.guardians, { notified: 0, failed: 1, reason: "channel-not-configured" });

  const read = await get(`/alert/${drillAlertId}`);
  assert.equal(read.body.alert.guardians.notified, 1);
  assert.equal(read.body.alert.guardians.accepted, 0);
  assert.equal(read.body.alert.guardians.responses[0].guardianId, guardianId);
  assert.equal(read.body.alert.guardians.responses[0].state, "notified");
  assert.equal(read.body.alert.guardians.responses[0].distanceKm, 0.1);
});

test("drill 3 — Asha accepts and her live pin moves on the victim read", async () => {
  assert.equal(
    (await post(`/alert/${drillAlertId}/guardian/${guardianId}/location`, { lat: 28.612, lng: 77.208 })).status,
    409,
    "no live pin before accept"
  );
  assert.equal((await post(`/alert/${drillAlertId}/guardian/${guardianId}/accept`, {})).status, 200);
  assert.equal(
    (await post(`/alert/${drillAlertId}/guardian/${guardianId}/location`, { lat: 91, lng: 77.2 })).status,
    400
  );
  const moved = await post(`/alert/${drillAlertId}/guardian/${guardianId}/location`, { lat: 28.612, lng: 77.208 });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.distanceKm, 0.2);

  const read = await get(`/alert/${drillAlertId}`);
  assert.equal(read.body.alert.guardians.accepted, 1);
  assert.equal(read.body.alert.guardians.locations.length, 1);
  assert.equal(read.body.alert.guardians.locations[0].lat, 28.612);
  assert.equal(read.body.alert.guardians.locations[0].distanceKm, 0.2);
});

test("drill 4 — victim and guardian exchange preset messages", async () => {
  const v = await post(`/alert/${drillAlertId}/message`, { sender: "victim", key: "please-hurry" });
  assert.equal(v.status, 200);
  assert.equal(v.body.message.text, "Please hurry");
  const g = await post(`/alert/${drillAlertId}/message`, { sender: "guardian", guardianId, key: "on-my-way" });
  assert.equal(g.status, 200);
  assert.equal(g.body.message.text, "I'm on my way to you");

  const read = await get(`/alert/${drillAlertId}`);
  assert.deepEqual(
    read.body.alert.guardians.messages.map((m) => [m.from, m.key]),
    [
      ["victim", "please-hurry"],
      [guardianId, "on-my-way"],
    ]
  );
});

test("drill 5 — contact view page: guardian line, counts + distance, never her coords", async () => {
  const token = viewToken(drillAlertId);
  const page = await getHtml(`/alert/${drillAlertId}/view?token=${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /1 on the way/);
  assert.match(page.text, /0\.2 km away/);
  assert.equal(page.text.includes("28.612"), false);
  assert.equal(page.text.includes("77.208"), false);
});

test("drill 6 — police layer: nearest station + 112 (Overpass stubbed, no network)", async () => {
  const orig = axios.get;
  axios.get = async () => ({
    data: {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 28.6145,
          lon: 77.2095,
          tags: { amenity: "police", name: "CP Police Station", phone: "011-2345 6789", opening_hours: "24/7" },
        },
      ],
    },
  });
  try {
    const res = await fetch(`${base}/police/nearest?lat=28.6139&lng=77.209`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.emergencyNumber, "112");
    assert.equal(body.station.name, "CP Police Station");
    assert.equal(body.station.phone, "011-2345 6789");
    assert.ok(body.station.distanceKm < 0.5);
  } finally {
    axios.get = orig;
  }
});

test("drill 7 — one false alarm mid-drill does NOT block the real SOS", async () => {
  const falseAlarm = seedDeliveredWithGuardian();
  assert.equal((await post(`/alert/${falseAlarm.id}/close`, { reason: "false-alarm" })).status, 200);
  assert.equal(strikes.strikeCount(IP_ACTOR), 1);
  assert.equal(strikes.isBlocked(IP_ACTOR), false);

  const real = await sos();
  assert.notEqual(real.status, 403, "one strike must not block SOS");
  assert.ok(real.body.alertId);
  assert.equal(real.status, 502, "channels still down — honest failure, gate passed");
});

test("drill 8 — three false alarms DO block SOS (D23 gate holds, end of drill)", async () => {
  for (let i = 0; i < 2; i++) {
    const falseAlarm = seedDeliveredWithGuardian();
    assert.equal((await post(`/alert/${falseAlarm.id}/close`, { reason: "false-alarm" })).status, 200);
  }
  assert.equal(strikes.strikeCount(IP_ACTOR), 3);
  assert.equal(strikes.isBlocked(IP_ACTOR), true);

  const blocked = await sos();
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /strike/i);
  assert.equal(blocked.body.alertId, undefined);
  assert.ok(auditLines.some((l) => l.includes("alert.blocked_by_strikes")));
});

test("drill 9 — resolved close ends a delivered alert; its view page goes 410", async () => {
  const alert = seedDeliveredWithGuardian();
  assert.equal((await post(`/alert/${alert.id}/close`, { reason: "resolved" })).status, 200);
  const page = await getHtml(`/alert/${alert.id}/view?token=${viewToken(alert.id)}`);
  assert.equal(page.status, 410);
});
