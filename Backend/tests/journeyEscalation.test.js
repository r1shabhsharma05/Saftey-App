// 🧭 Journey escalation — QStash scheduling + the escalate decision
// (SafeLife 2.0 Day 17, plan §6 D17, plan §3 F4).
//
// The timer half of D17: one job at create (overdue-escalate at
// ETA + 5 min grace) and one per check-in asked (checkin-escalate
// at askedAt + 5 min). The callback re-checks everything before
// sending — a late arrival, an "I'm OK", or a stale job must never
// fan out. No channel can actually send here: every adapter is
// unconfigured in tests, so the fan-out asserts are the honest
// "sent 0, failed N, nothing left the process" shape.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d17-test-secret";
process.env.PUBLIC_BASE_URL = "https://example.invalid";
process.env.QSTASH_TOKEN = "qstash-test-token";

const { createJourney } = require("../services/journey");
const { recordJourneyLocation } = require("../services/journeyWatch");
const { journeyToken } = require("../services/journeyView");
const { escalationToken } = require("../services/escalation");
const {
  JOURNEY_ESCALATION_KINDS,
  CHECKIN_GRACE_MS,
  journeyEscalationToken,
  verifyJourneyEscalationToken,
  escalationMessage,
  scheduleJourneyEscalation,
  shouldEscalateJourney,
  runJourneyEscalation,
} = require("../services/journeyEscalation");
const { _setQstashTransport } = require("../services/qstash");

const jobs = [];
_setQstashTransport(async (job) => {
  jobs.push(job);
  return { messageId: "msg_journey" };
});

const ORIGIN = { lat: 27.6057, lng: 77.5933 };
const DEST = { lat: 27.4924, lng: 77.6737 };
const MID = { lat: (ORIGIN.lat + DEST.lat) / 2, lng: (ORIGIN.lng + DEST.lng) / 2 };

const makeJourney = (etaMinutes = 25) =>
  createJourney({
    originLat: ORIGIN.lat,
    originLng: ORIGIN.lng,
    destLat: DEST.lat,
    destLng: DEST.lng,
    destinationLabel: "Mathura Junction",
    expectedArrivalAt: new Date(Date.now() + etaMinutes * 60 * 1000).toISOString(),
    userName: "Test Traveller",
    contacts: [
      { phone: "+919876543210", pushToken: "" },
      { phone: "", pushToken: "ExponentPushToken[abc]" },
    ],
  });

test("kinds are exactly the two timer jobs D17 schedules", () => {
  assert.deepEqual(JOURNEY_ESCALATION_KINDS, ["overdue-escalate", "checkin-escalate"]);
  assert.equal(CHECKIN_GRACE_MS, 5 * 60 * 1000);
});

test("journey escalation token is domain-separated and tamper-proof", () => {
  const token = journeyEscalationToken("journey-1", "overdue-escalate");
  assert.ok(token);
  assert.notEqual(token, escalationToken("journey-1", 1), "must not collide with the SOS ladder token");
  assert.notEqual(token, journeyToken("journey-1"), "must not collide with the share-view token");
  assert.equal(verifyJourneyEscalationToken("journey-1", "overdue-escalate", token), true);
  assert.equal(verifyJourneyEscalationToken("journey-1", "checkin-escalate", token), false);
  assert.equal(verifyJourneyEscalationToken("journey-1", "overdue-escalate", "0".repeat(64)), false);
  assert.equal(verifyJourneyEscalationToken("journey-1", "overdue-escalate", ""), false);
  delete process.env.API_SECRET;
  assert.equal(journeyEscalationToken("journey-1", "overdue-escalate"), null);
  assert.equal(verifyJourneyEscalationToken("journey-1", "overdue-escalate", token), false);
process.env.API_SECRET = "d17-test-secret";
});

test("escalationMessage names the trip, the reason, the last pin and a link", () => {
  const j = makeJourney();
  recordJourneyLocation(j, MID.lat, MID.lng);
  const msg = escalationMessage(j, "overdue", "https://example.invalid/journey/x/view?token=t");
  assert.match(msg, /Mathura Junction/);
  assert.match(msg, /overdue/);
  assert.match(msg, new RegExp(String(MID.lat)));
  assert.match(msg, /example\.invalid\/journey\/x\/view/);
  const noLink = escalationMessage(j, "deviated", null);
  assert.match(noLink, /maps\.google\.com/);
  assert.ok(escalationMessage(j, "stopped", null).length <= 4000);
});

test("scheduleJourneyEscalation queues a delayed callback with paired contacts", async () => {
  const j = makeJourney();
  const before = jobs.length;
  const res = await scheduleJourneyEscalation({ journey: j, kind: "overdue-escalate", delaySeconds: 1800 });
  assert.equal(res.queued, true);
  assert.equal(res.kind, "overdue-escalate");
  assert.equal(jobs.length, before + 1);
  const job = jobs[jobs.length - 1];
  assert.equal(job.url, "https://example.invalid/journey-escalate");
  assert.equal(job.delaySeconds, 1800);
  assert.equal(job.body.journeyId, j.id);
  assert.equal(job.body.kind, "overdue-escalate");
  assert.ok(job.body.token);
  // Phones and push tokens ride paired by index, D10's pairing rule.
  assert.deepEqual(job.body.contacts, ["+919876543210", ""]);
  assert.deepEqual(job.body.pushTokens, ["", "ExponentPushToken[abc]"]);
  assert.match(job.deduplicationId, /journey-escalation:/);
});

test("scheduleJourneyEscalation reports every unconfigured half honestly", async () => {
  const j = makeJourney();
  delete process.env.QSTASH_TOKEN;
  assert.deepEqual(
    (await scheduleJourneyEscalation({ journey: j, kind: "overdue-escalate", delaySeconds: 60 })).reason,
    "not-configured"
  );
  process.env.QSTASH_TOKEN = "qstash-test-token";
  delete process.env.PUBLIC_BASE_URL;
  assert.deepEqual(
    (await scheduleJourneyEscalation({ journey: j, kind: "overdue-escalate", delaySeconds: 60 })).reason,
    "no-public-url"
  );
  process.env.PUBLIC_BASE_URL = "https://example.invalid";
  delete process.env.API_SECRET;
  assert.deepEqual(
    (await scheduleJourneyEscalation({ journey: j, kind: "overdue-escalate", delaySeconds: 60 })).reason,
    "no-signing-secret"
  );
process.env.API_SECRET = "d17-test-secret";
  assert.deepEqual(
    (await scheduleJourneyEscalation({ journey: j, kind: "nope", delaySeconds: 60 })).reason,
    "invalid-kind"
  );
});

test("shouldEscalateJourney stands down on arrival, all-clear, OK answer and stale jobs", () => {
  const now = Date.now();
  const j = makeJourney();
  j.expectedArrivalAt = new Date(now - 60 * 1000).toISOString(); // overdue
  assert.deepEqual(shouldEscalateJourney(j, "overdue-escalate", null, now), { escalate: true, reason: "overdue" });
  // Arrived after the timer was scheduled: never escalate.
  j.state = "arrived";
  assert.deepEqual(shouldEscalateJourney(j, "overdue-escalate", null, now).escalate, false);
  j.state = "active";
  // "I'm OK" for the overdue reason inside the cooldown stands down.
  j.lastOkAt = new Date(now - 2 * 60 * 1000).toISOString();
  j.lastOkReason = "overdue";
  assert.deepEqual(shouldEscalateJourney(j, "overdue-escalate", null, now).escalate, false);
  // Same answer, different reason: still escalate.
  j.lastOkReason = "deviated";
  assert.deepEqual(shouldEscalateJourney(j, "overdue-escalate", null, now).escalate, true);

  // Check-in job: askedAt must match the live prompt, and the trip
  // must still be off-route.
  const j2 = makeJourney();
  recordJourneyLocation(j2, MID.lat, MID.lng + 0.006); // deviated
  const askedAt = new Date(now).toISOString();
  j2.checkIn = { reason: "deviated", askedAt, dueAt: new Date(now + CHECKIN_GRACE_MS).toISOString() };
  assert.deepEqual(shouldEscalateJourney(j2, "checkin-escalate", askedAt, now), { escalate: true, reason: "deviated" });
  assert.deepEqual(
    shouldEscalateJourney(j2, "checkin-escalate", new Date(now - 60000).toISOString(), now).escalate,
    false,
    "a stale askedAt must not fire"
  );
  recordJourneyLocation(j2, MID.lat, MID.lng); // back on the line
  assert.deepEqual(shouldEscalateJourney(j2, "checkin-escalate", askedAt, now).escalate, false);
});

test("runJourneyEscalation fans out to all channels and reports honestly with none configured", async () => {
  const j = makeJourney();
  const res = await runJourneyEscalation({ journey: j, reason: "overdue", viewUrl: null });
  assert.equal(res.sent, 0, "no channel is configured, so nothing may claim a send");
  assert.equal(res.failed, 4, "all four channels report their failure");
  assert.equal(res.receipts.length, 4);
  assert.ok(res.message.includes("Mathura Junction"));
});
