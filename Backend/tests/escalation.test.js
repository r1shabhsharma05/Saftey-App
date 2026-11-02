// Escalation ladder tests — SafeLife 2.0 Day 10.
// Pure decisions + HMAC tokens + QStash scheduling. The ladder is
// QStash delayed callbacks (amendment A2): no in-process timers.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d10-escalation-secret";
process.env.PUBLIC_BASE_URL = "https://example.invalid";
process.env.QSTASH_TOKEN = "fake-qstash-token";

const { retryToken } = require("../services/delivery");
const { viewToken } = require("../services/alertView");
const { createAlert, transition, recordAck, ackKeyFor } = require("../services/alertLifecycle");
const {
  ACK_THRESHOLD,
  ESCALATION_STEPS,
  escalationToken,
  verifyEscalationToken,
  shouldEscalate,
  failedChannels,
  unackedContacts,
  scheduleEscalation,
} = require("../services/escalation");
const { _setQstashTransport } = require("../services/qstash");

const jobs = [];
_setQstashTransport(async (job) => {
  jobs.push(job);
  return { messageId: "msg_esc" };
});

test("ladder steps: +30s refire, +60s refire, +120s voice call", () => {
  assert.deepEqual(ESCALATION_STEPS, [
    { step: 1, delaySeconds: 30, action: "refire-failed-channels" },
    { step: 2, delaySeconds: 60, action: "refire-failed-channels" },
    { step: 3, delaySeconds: 120, action: "voice-call" },
  ]);
  assert.equal(ACK_THRESHOLD, 2);
});

test("escalation token: domain-separated from retry/view tokens, tamper-proof", () => {
  const token = escalationToken("alert-1", 1);
  assert.ok(token);
  assert.notEqual(token, retryToken("alert-1", 1));
  assert.notEqual(token, viewToken("alert-1"));
  assert.equal(verifyEscalationToken("alert-1", 1, token), true);
  assert.equal(verifyEscalationToken("alert-1", 2, token), false);
  assert.equal(verifyEscalationToken("alert-1", 1, "0".repeat(64)), false);
  assert.equal(verifyEscalationToken("alert-1", 1, ""), false);
  delete process.env.API_SECRET;
  assert.equal(escalationToken("alert-1", 1), null);
  assert.equal(verifyEscalationToken("alert-1", 1, token), false);
  process.env.API_SECRET = "d10-escalation-secret";
});

test("recordAck: hashed dedupe, threshold is a count; the route owns the state move", () => {
  const alert = createAlert({ contactsCount: 2 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  assert.deepEqual(alert.acks, []);
  assert.equal(ackKeyFor({ phone: "+91 99999 99999" }), ackKeyFor({ phone: "+919999999999" }));
  assert.ok(!ackKeyFor({ phone: "+919999999999" }).includes("99999"));
  const first = recordAck(alert, { phone: "+919999999999" });
  assert.equal(first.isNew, true);
  assert.equal(alert.state, "delivered", "recordAck never transitions — the ack route moves delivered→acked");
  transition(alert, "acked", "contact acknowledged");
  assert.equal(alert.state, "acked");
  assert.equal(recordAck(alert, { phone: "+919999999999" }).isNew, false);
  assert.equal(alert.acks.length, 1);
  recordAck(alert, { pushToken: "device-token-abc" });
  assert.equal(alert.acks.length, 2);
  assert.equal(shouldEscalate(alert), false, "2 distinct acks stop the ladder");
  // Anonymous (no identifier) acks share one slot: one contact cannot
  // stop the ladder by refreshing the view page.
  const anon = createAlert({ contactsCount: 1 });
  transition(anon, "dispatching");
  transition(anon, "delivered");
  recordAck(anon, {});
  recordAck(anon, {});
  assert.equal(anon.acks.length, 1);
});

test("shouldEscalate: only live delivered/acked alerts below threshold", () => {
  const mk = (state, acks) => {
    const a = createAlert({ contactsCount: 2 });
    a.state = state;
    a.acks = acks;
    return a;
  };
  assert.equal(shouldEscalate(mk("delivered", [])), true);
  assert.equal(shouldEscalate(mk("acked", [{ key: "x", at: "t" }])), true);
  assert.equal(shouldEscalate(mk("acked", [{ key: "x", at: "t" }, { key: "y", at: "t" }])), false);
  assert.equal(shouldEscalate(mk("closed", [])), false);
  assert.equal(shouldEscalate(mk("failed", [])), false);
  assert.equal(shouldEscalate(mk("created", [])), false);
  assert.equal(shouldEscalate(mk("dispatching", [])), false);
});

test("failedChannels: failed + partial refire; delivered channels are left alone", () => {
  const receipts = [
    { channel: "telegram", state: "delivered", sent: 1, failed: 0 },
    { channel: "sms", state: "partial", sent: 1, failed: 1 },
    { channel: "whatsapp", state: "failed", sent: 0, failed: 1 },
    { channel: "push", state: "failed", sent: 0, failed: 1, reason: "channel-not-configured" },
  ];
  assert.deepEqual(failedChannels(receipts), ["sms", "whatsapp", "push"]);
  assert.deepEqual(failedChannels([]), []);
  assert.deepEqual(failedChannels(null), []);
});

test("unackedContacts: acked phones excluded, invalid/dupes dropped, phones only", () => {
  const alert = createAlert({ contactsCount: 3 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  recordAck(alert, { phone: "+919999999999" });
  const contacts = [
    { phone: "+919999999999", name: "Asha" },
    { phone: "+918888888888", name: "Ravi" },
    { phone: "+918888888888", name: "Ravi dup" },
    { phone: "junk" },
    { pushToken: "tok-only" },
    {},
  ];
  assert.deepEqual(unackedContacts(alert, contacts), [
    { phone: "+918888888888", name: "Ravi" },
  ]);
});

test("scheduleEscalation: three QStash jobs with delays, dedup ids and HMAC bodies", async () => {
  jobs.length = 0;
  const res = await scheduleEscalation({
    alertId: "alert-1",
    message: "SOS",
    contacts: [{ phone: "+919999999999", pushToken: "tok" }],
  });
  assert.equal(res.steps.length, 3);
  assert.ok(res.steps.every((s) => s.queued));
  assert.deepEqual(res.steps.map((s) => s.delaySeconds), [30, 60, 120]);
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].delaySeconds, 30);
  assert.equal(jobs[2].delaySeconds, 120);
  assert.equal(jobs[1].deduplicationId, "escalation:alert-1:2");
  assert.ok(jobs[0].url.endsWith("/escalate"));
  assert.equal(jobs[0].body.alertId, "alert-1");
  assert.equal(jobs[0].body.step, 1);
  assert.equal(jobs[0].body.message, "SOS");
  assert.deepEqual(jobs[0].body.contacts, ["+919999999999"]);
  assert.deepEqual(jobs[0].body.pushTokens, ["tok"]);
  assert.equal(verifyEscalationToken("alert-1", 1, jobs[0].body.token), true);
});

test("scheduleEscalation: honest queued:false when signing/public/QStash missing", async () => {
  delete process.env.API_SECRET;
  const noSecret = await scheduleEscalation({ alertId: "a", message: "SOS", contacts: [] });
  assert.ok(noSecret.steps.every((s) => !s.queued && s.reason === "no-signing-secret"));
  process.env.API_SECRET = "d10-escalation-secret";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.VERCEL_URL;
  const noUrl = await scheduleEscalation({ alertId: "a", message: "SOS", contacts: [] });
  assert.ok(noUrl.steps.every((s) => !s.queued && s.reason === "no-public-url"));
  process.env.PUBLIC_BASE_URL = "https://example.invalid";
});
