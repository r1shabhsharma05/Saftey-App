// Unit tests for services/guardianAlert.js — SafeLife 2.0 Day 21
// (Guardian alert flow: accept/decline, live two-side tracking,
// chat-lite preset messages). Pure part first; the notify I/O part
// below drives the real matcher + guardian store with a fake SMS
// sender (the real sendSms is covered by sms.test.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  RESPONSE_WINDOW_MS,
  MAX_MESSAGES,
  PRESET_MESSAGES,
  newGuardianAlertState,
  recordNotification,
  isExpired,
  acceptResponse,
  declineResponse,
  recordGuardianAlertLocation,
  addMessage,
  guardianAlertSummary,
  notifyGuardiansForAlert,
} = require("../services/guardianAlert");
const { createGuardian, issueCode, verifyCode, setAvailable } = require("../services/guardian");
const guardianStore = require("../services/guardianStore");
const { recordGuardianLocation, _locations } = require("../services/guardianMatch");

const NOW = Date.parse("2026-11-13T08:00:00.000Z");
const notifiedAt = new Date(NOW - 60 * 1000).toISOString();
// Literal 15 min — pins the window in the fixture itself. Deriving
// this from the imported RESPONSE_WINDOW_MS would adapt to a
// mutation of the constant instead of catching it (D19/D20 smell).
const expiredAt = new Date(NOW - 15 * 60 * 1000 - 1000).toISOString();

const notifiedState = () => {
  const state = newGuardianAlertState();
  recordNotification(state, {
    guardianId: "g1",
    name: "Asha",
    role: "family",
    distanceKm: 0.4,
    score: 0.8,
    nowMs: NOW - 60 * 1000,
  });
  return state;
};

// --- constants ---

test("RESPONSE_WINDOW_MS is 15 minutes (literal pin — a notified guardian older than this cannot respond)", () => {
  assert.equal(RESPONSE_WINDOW_MS, 15 * 60 * 1000);
});

test("MAX_MESSAGES is 50 (literal pin)", () => {
  assert.equal(MAX_MESSAGES, 50);
});

test("PRESET_MESSAGES: guardian and victim keys are disjoint and every key has text", () => {
  assert.deepEqual(Object.keys(PRESET_MESSAGES.guardian).sort(), [
    "almost-there",
    "calling-police",
    "on-my-way",
  ]);
  assert.deepEqual(Object.keys(PRESET_MESSAGES.victim).sort(), [
    "call-police",
    "i-am-safe",
    "please-hurry",
  ]);
  for (const role of ["guardian", "victim"]) {
    for (const text of Object.values(PRESET_MESSAGES[role])) {
      assert.equal(typeof text, "string");
      assert.ok(text.length > 0);
    }
  }
});

// --- state + notification ---

test("newGuardianAlertState: empty responses, locations and messages", () => {
  assert.deepEqual(newGuardianAlertState(), { responses: {}, locations: {}, messages: [] });
});

test("recordNotification: stores the notified response with distance, score and time", () => {
  const state = newGuardianAlertState();
  const r = recordNotification(state, {
    guardianId: "g1",
    name: "Asha",
    role: "family",
    distanceKm: 0.4,
    score: 0.8,
    nowMs: NOW,
  });
  assert.equal(r.state, "notified");
  assert.equal(r.name, "Asha");
  assert.equal(r.distanceKm, 0.4);
  assert.equal(r.score, 0.8);
  assert.equal(r.notifiedAt, new Date(NOW).toISOString());
  assert.equal(r.respondedAt, null);
  assert.equal(state.responses.g1, r);
});

// --- expiry ---

test("isExpired: a notified response older than 15 min is expired; accepted/declined never expire", () => {
  assert.equal(isExpired({ state: "notified", notifiedAt: expiredAt }, NOW), true);
  assert.equal(isExpired({ state: "notified", notifiedAt }, NOW), false);
  const accepted = { state: "accepted", notifiedAt: expiredAt, respondedAt: notifiedAt };
  assert.equal(isExpired(accepted, NOW), false);
  const declined = { state: "declined", notifiedAt: expiredAt, respondedAt: notifiedAt };
  assert.equal(isExpired(declined, NOW), false);
});

// --- accept / decline ---

test("acceptResponse: notified → accepted with respondedAt; repeat accept is an idempotent no-op", () => {
  const state = notifiedState();
  const first = acceptResponse(state, "g1", NOW);
  assert.equal(first.already, false);
  assert.equal(state.responses.g1.state, "accepted");
  assert.equal(state.responses.g1.respondedAt, new Date(NOW).toISOString());
  const second = acceptResponse(state, "g1", NOW + 1000);
  assert.equal(second.already, true);
  assert.equal(state.responses.g1.respondedAt, new Date(NOW).toISOString());
});

test("acceptResponse: unknown guardian throws; expired throws; declined throws", () => {
  const state = notifiedState();
  assert.throws(() => acceptResponse(state, "nope", NOW), /Unknown guardian response/);
  const stale = notifiedState();
  stale.responses.g1.notifiedAt = expiredAt;
  assert.throws(() => acceptResponse(stale, "g1", NOW), /expired/);
  const declined = notifiedState();
  declineResponse(declined, "g1", NOW);
  assert.throws(() => acceptResponse(declined, "g1", NOW), /already declined/);
});

test("declineResponse: notified → declined; repeat decline is an idempotent no-op; accepted cannot decline", () => {
  const state = notifiedState();
  const first = declineResponse(state, "g1", NOW);
  assert.equal(first.already, false);
  assert.equal(state.responses.g1.state, "declined");
  assert.equal(declineResponse(state, "g1", NOW + 1000).already, true);
  const accepted = notifiedState();
  acceptResponse(accepted, "g1", NOW);
  assert.throws(() => declineResponse(accepted, "g1", NOW), /already accepted/);
});

// --- live location ---

test("recordGuardianAlertLocation: accepted guardian posts a pin; unaccepted throws; bad coords throw", () => {
  const state = notifiedState();
  assert.throws(
    () => recordGuardianAlertLocation(state, "g1", 28.6, 77.2, NOW),
    /has not accepted/
  );
  acceptResponse(state, "g1", NOW);
  const pin = recordGuardianAlertLocation(state, "g1", 28.61, 77.21, NOW);
  assert.equal(pin.lat, 28.61);
  assert.equal(pin.lng, 77.21);
  assert.equal(pin.updatedAt, new Date(NOW).toISOString());
  assert.equal(state.locations.g1, pin);
  assert.throws(() => recordGuardianAlertLocation(state, "g1", 999, 77.2, NOW), /Invalid latitude/);
  assert.throws(() => recordGuardianAlertLocation(state, "g1", 28.6, 999, NOW), /Invalid longitude/);
  assert.throws(() => recordGuardianAlertLocation(state, "ghost", 28.6, 77.2, NOW), /Unknown guardian response/);
});

// --- preset messages ---

test("addMessage: victim and guardian presets land with server-rendered text; cross-role keys throw", () => {
  const state = notifiedState();
  acceptResponse(state, "g1", NOW);
  const v = addMessage(state, { sender: "victim", key: "please-hurry", nowMs: NOW });
  assert.equal(v.from, "victim");
  assert.equal(v.key, "please-hurry");
  assert.equal(v.text, PRESET_MESSAGES.victim["please-hurry"]);
  const g = addMessage(state, { sender: "guardian", guardianId: "g1", key: "on-my-way", nowMs: NOW });
  assert.equal(g.from, "g1");
  assert.equal(g.text, PRESET_MESSAGES.guardian["on-my-way"]);
  assert.throws(() => addMessage(state, { sender: "victim", key: "on-my-way", nowMs: NOW }), /Unknown message/);
  assert.throws(() => addMessage(state, { sender: "guardian", guardianId: "g1", key: "please-hurry", nowMs: NOW }), /Unknown message/);
  assert.throws(() => addMessage(state, { sender: "guardian", guardianId: "g1", key: "nope", nowMs: NOW }), /Unknown message/);
});

test("addMessage: a guardian who has not accepted cannot message; unknown guardian cannot message", () => {
  const state = notifiedState();
  assert.throws(
    () => addMessage(state, { sender: "guardian", guardianId: "g1", key: "on-my-way", nowMs: NOW }),
    /has not accepted/
  );
  assert.throws(
    () => addMessage(state, { sender: "guardian", guardianId: "ghost", key: "on-my-way", nowMs: NOW }),
    /Unknown guardian response/
  );
});

test("addMessage: the log caps at 50, oldest dropped", () => {
  const state = notifiedState();
  for (let i = 0; i < 55; i++) {
    addMessage(state, { sender: "victim", key: "please-hurry", nowMs: NOW + i * 1000 });
  }
  assert.equal(state.messages.length, 50);
  assert.equal(state.messages[0].at, new Date(NOW + 5 * 1000).toISOString());
  assert.equal(state.messages[49].at, new Date(NOW + 54 * 1000).toISOString());
});

// --- summary ---

test("guardianAlertSummary: counts, responses in notify order, accepted locations with distance, messages", () => {
  const state = notifiedState();
  recordNotification(state, {
    guardianId: "g2",
    name: "Ravi",
    role: "security",
    distanceKm: 1.2,
    score: 0.4,
    nowMs: NOW - 30 * 1000,
  });
  acceptResponse(state, "g1", NOW);
  recordGuardianAlertLocation(state, "g1", 28.6145, 77.2095, NOW);
  addMessage(state, { sender: "victim", key: "please-hurry", nowMs: NOW });
  const s = guardianAlertSummary(state, { lat: 28.6139, lng: 77.209 });
  assert.equal(s.notified, 2);
  assert.equal(s.accepted, 1);
  assert.deepEqual(
    s.responses.map((r) => [r.guardianId, r.state]),
    [
      ["g1", "accepted"],
      ["g2", "notified"],
    ]
  );
  assert.equal(s.locations.length, 1);
  assert.equal(s.locations[0].guardianId, "g1");
  assert.equal(s.locations[0].lat, 28.6145);
  // ~70 m from the victim pin — rounds to 0.1 km.
  assert.equal(s.locations[0].distanceKm, 0.1);
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].from, "victim");
  assert.equal(s.messages[0].name, null);
  // The guardian message carries the sender's name; the victim one does not.
  addMessage(state, { sender: "guardian", guardianId: "g1", key: "on-my-way", nowMs: NOW + 1000 });
  assert.equal(guardianAlertSummary(state, { lat: 28.6139, lng: 77.209 }).messages[1].name, "Asha");
});

test("guardianAlertSummary: no coordinates leak for a merely-notified guardian", () => {
  const state = notifiedState();
  const s = guardianAlertSummary(state, { lat: 28.6139, lng: 77.209 });
  assert.equal(s.locations.length, 0);
  assert.ok(!JSON.stringify(s).includes("28.6"));
});

// --- notify I/O ---

const seedVerifiedGuardian = async (over = {}) => {
  const guardian = createGuardian({
    userId: over.userId || "user-1",
    name: over.name || "Asha",
    phone: over.phone || "+919876543210",
    role: over.role || "family",
  });
  guardianStore.save(guardian);
  const { code } = issueCode(guardian);
  verifyCode(guardian, code);
  setAvailable(guardian, over.available !== false);
  guardianStore.save(guardian);
  await recordGuardianLocation(guardian.id, over.lat ?? 28.614, over.lng ?? 77.2095);
  return guardian;
};

test("notifyGuardiansForAlert: matched guardian gets an SMS with a maps link; response recorded", async () => {
  guardianStore._clearMemory();
  _locations.clear();
  const guardian = await seedVerifiedGuardian();
  const alert = { id: "alert-1", guardians: null };
  const sent = [];
  const res = await notifyGuardiansForAlert({
    alert,
    lat: 28.6139,
    lng: 77.209,
    sendSmsFn: async ({ to, content }) => {
      sent.push({ to, content });
      return { sent: 1, failed: 0 };
    },
  });
  assert.equal(res.notified, 1);
  assert.equal(res.failed, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, guardian.phone);
  assert.ok(sent[0].content.includes("https://maps.google.com/?q=28.6139,77.209"));
  assert.ok(sent[0].content.includes("km away"));
  assert.equal(alert.guardians.responses[guardian.id].state, "notified");
  assert.ok(typeof alert.guardians.notifiedAt === "string");
});

test("notifyGuardiansForAlert: no guardian nearby → notified 0 with reason, no SMS", async () => {
  guardianStore._clearMemory();
  _locations.clear();
  const alert = { id: "alert-2", guardians: null };
  const sent = [];
  const res = await notifyGuardiansForAlert({
    alert,
    lat: 28.6139,
    lng: 77.209,
    sendSmsFn: async ({ to, content }) => {
      sent.push({ to, content });
      return { sent: 1, failed: 0 };
    },
  });
  assert.equal(res.notified, 0);
  assert.equal(res.failed, 0);
  assert.equal(res.reason, "no-guardians-nearby");
  assert.equal(sent.length, 0);
});

test("notifyGuardiansForAlert: second call is an idempotent no-op (no second SMS)", async () => {
  guardianStore._clearMemory();
  _locations.clear();
  await seedVerifiedGuardian();
  const alert = { id: "alert-3", guardians: null };
  let calls = 0;
  const sender = async () => {
    calls++;
    return { sent: 1, failed: 0 };
  };
  await notifyGuardiansForAlert({ alert, lat: 28.6139, lng: 77.209, sendSmsFn: sender });
  const second = await notifyGuardiansForAlert({ alert, lat: 28.6139, lng: 77.209, sendSmsFn: sender });
  assert.equal(second.already, true);
  assert.equal(second.notified, 0);
  assert.equal(calls, 1);
});

test("notifyGuardiansForAlert: a failed SMS counts as failed, not notified; first failure reason surfaces", async () => {
  guardianStore._clearMemory();
  _locations.clear();
  await seedVerifiedGuardian();
  const alert = { id: "alert-4", guardians: null };
  const res = await notifyGuardiansForAlert({
    alert,
    lat: 28.6139,
    lng: 77.209,
    sendSmsFn: async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" }),
  });
  assert.equal(res.notified, 0);
  assert.equal(res.failed, 1);
  assert.equal(res.reason, "channel-not-configured");
  // The response still exists (the guardian was matched) — the app can
  // show "matched but not reached" instead of pretending nobody is near.
  assert.equal(Object.keys(alert.guardians.responses).length, 1);
  assert.equal(alert.guardians.responses[Object.keys(alert.guardians.responses)[0]].state, "notified");
});

test("notifyGuardiansForAlert: off-duty and pending guardians are never notified", async () => {
  guardianStore._clearMemory();
  _locations.clear();
  await seedVerifiedGuardian({ available: false, phone: "+919876543211", userId: "user-2" });
  const pending = createGuardian({ userId: "user-3", name: "Pending", phone: "+919876543212", role: "friend" });
  guardianStore.save(pending);
  await recordGuardianLocation(pending.id, 28.614, 77.2095);
  const alert = { id: "alert-5", guardians: null };
  let calls = 0;
  const res = await notifyGuardiansForAlert({
    alert,
    lat: 28.6139,
    lng: 77.209,
    sendSmsFn: async () => {
      calls++;
      return { sent: 1, failed: 0 };
    },
  });
  assert.equal(res.notified, 0);
  assert.equal(res.reason, "no-guardians-nearby");
  assert.equal(calls, 0);
});
