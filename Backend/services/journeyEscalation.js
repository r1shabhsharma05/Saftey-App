// 🧭 Journey escalation — timers + the escalate decision + fan-out
// (SafeLife 2.0 Day 17, plan §6 D17, plan §3 F4).
//
// Two timer jobs, both QStash delayed callbacks to POST
// /journey-escalate (amendment A2 — no in-process timers on
// serverless), both scheduled with the contacts in their body (D16's
// design: the server stores no contact list at create, the job
// carries it; the in-memory journey record is the primary source
// and the body is the cross-instance fallback — the L5-twin lesson
// from /escalate):
//   overdue-escalate  — scheduled at create, fires at ETA + 5 min.
//   checkin-escalate  — scheduled when a check-in is first asked,
//                       fires at askedAt + 5 min.
//
// The callback re-checks everything (shouldEscalateJourney) before
// sending: a late arrival, an "I'm OK", a trip back on route, or a
// stale check-in all stand down. The message is built from the
// journey RECORD, never from the job body — a forged body cannot
// rewrite what contacts are told. Fan-out reuses D4's deliverAlert
// (Telegram + SMS + WhatsApp + push in parallel); with no channel
// configured it honestly reports sent 0.
const crypto = require("crypto");
const { deliverAlert, publicBaseUrl } = require("./delivery");
const { publishDelayed } = require("./qstash");
const { watchStatus, CHECKIN_GRACE_MS } = require("./journeyWatch");
const { journeyToken } = require("./journeyView");

const JOURNEY_ESCALATION_KINDS = ["overdue-escalate", "checkin-escalate"];

const journeyEscalationToken = (journeyId, kind) => {
  const secret = process.env.API_SECRET || "";
  if (!secret || typeof journeyId !== "string" || !journeyId || !JOURNEY_ESCALATION_KINDS.includes(kind)) {
    return null;
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`journey-escalation:${journeyId}:${kind}`)
    .digest("hex");
};

const verifyJourneyEscalationToken = (journeyId, kind, token) => {
  const expected = journeyEscalationToken(journeyId, kind);
  if (!expected || typeof token !== "string") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// The contacts message — built from the record. The link is the
// signed share page when one can be minted (PUBLIC_BASE_URL +
// API_SECRET both set), else a Google Maps pin: a contact with no
// link still gets coordinates they can act on.
const escalationMessage = (journey, reason, viewUrl) => {
  const label = journey?.destination?.label || "their destination";
  const name = typeof journey?.userName === "string" && journey.userName ? journey.userName : "A SafeLife user";
  const lat = journey?.lat;
  const lng = journey?.lng;
  const at = journey?.locationAt || journey?.updatedAt || "";
  const pin =
    typeof lat === "number" && typeof lng === "number"
      ? `Last location: ${lat}, ${lng} at ${at}.`
      : "No location fix is available.";
  const link = viewUrl ? `Follow the live trip: ${viewUrl}` : `Open the last pin: https://maps.google.com/?q=${lat},${lng}`;
  return (
    `SafeLife: ${name} has not checked in — trip to ${label} is ${reason}. ` +
    `${pin} ${link}`
  ).slice(0, 4000);
};

// Schedules one timer job. Returns { kind, delaySeconds, queued,
// reason? } — callers must surface queued:false, never treat it as
// scheduled (the qstash.js rule). Contacts ride paired by index,
// D10's pairing rule (phones[i] ↔ pushTokens[i]).
const scheduleJourneyEscalation = async ({ journey, kind, delaySeconds, askedAt = null } = {}) => {
  if (!JOURNEY_ESCALATION_KINDS.includes(kind)) {
    return { kind, delaySeconds, queued: false, reason: "invalid-kind" };
  }
  const token = journeyEscalationToken(journey?.id, kind);
  if (!token) return { kind, delaySeconds, queued: false, reason: "no-signing-secret" };
  const base = publicBaseUrl();
  if (!base) return { kind, delaySeconds, queued: false, reason: "no-public-url" };
  const contacts = Array.isArray(journey?.contacts) ? journey.contacts.slice(0, 10) : [];
  const res = await publishDelayed({
    url: `${base}/journey-escalate`,
    body: {
      journeyId: journey.id,
      kind,
      token,
      ...(askedAt ? { askedAt } : {}),
      contacts: contacts.map((c) => (typeof c?.phone === "string" ? c.phone.slice(0, 20) : "")),
      pushTokens: contacts.map((c) => (typeof c?.pushToken === "string" ? c.pushToken.slice(0, 1024) : "")),
    },
    delaySeconds,
    deduplicationId: `journey-escalation:${journey.id}:${kind}:${askedAt || "eta"}`,
  });
  return res.queued
    ? { kind, delaySeconds, queued: true }
    : { kind, delaySeconds, queued: false, reason: res.reason || "publish-failed" };
};

// The callback's decision, pure and testable. Escalate only while
// the trip is live, still off-pattern for a reason, not freshly
// answered OK for that reason — and for a check-in job, only while
// the prompt it answers is still the live one (a re-ask retires
// the old job). An overdue job also requires the trip to actually
// be overdue at fire time, not merely deviated.
const shouldEscalateJourney = (journey, kind, askedAt, nowMs = Date.now()) => {
  if (!journey || journey.state !== "active") return { escalate: false, reason: "not-active" };
  const watch = watchStatus(journey, nowMs);
  if (!watch.reason) return { escalate: false, reason: "all-clear" };
  if (kind === "overdue-escalate" && watch.reason !== "overdue") {
    return { escalate: false, reason: "not-overdue" };
  }
  if (kind === "checkin-escalate") {
    if (!journey.checkIn || journey.checkIn.askedAt !== askedAt) {
      return { escalate: false, reason: "stale-checkin" };
    }
  }
  if (!watch.needsCheckIn) return { escalate: false, reason: "answered-ok" };
  return { escalate: true, reason: watch.reason };
};

// Fans the escalation out on all four channels and reports the
// receipts. Contacts come from the caller (stored record first,
// job body as fallback — the route merges them). The share link is
// minted here so the message carries a live page when configured.
const runJourneyEscalation = async ({ journey, reason, contacts = [] } = {}) => {
  const viewBase = publicBaseUrl();
  const token = journeyToken(journey?.id);
  const viewUrl = viewBase && token ? `${viewBase}/journey/${journey.id}/view?token=${token}` : null;
  const message = escalationMessage(journey, reason, viewUrl);
  const receipts = await deliverAlert({ message, contacts });
  const sent = receipts.reduce((n, r) => n + (r.sent || 0), 0);
  const failed = receipts.reduce((n, r) => n + (r.failed || 0), 0);
  return { sent, failed, receipts, message };
};

module.exports = {
  JOURNEY_ESCALATION_KINDS,
  CHECKIN_GRACE_MS,
  journeyEscalationToken,
  verifyJourneyEscalationToken,
  escalationMessage,
  scheduleJourneyEscalation,
  shouldEscalateJourney,
  runJourneyEscalation,
};
