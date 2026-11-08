// 🪜 Escalation ladder — SafeLife 2.0 Day 10 (plan §6 D10, amended A2).
//
// The plan's S3 ladder (T+0 push+Telegram → T+30s SMS → T+60s
// WhatsApp → T+2min voice call) meets the code D4–D9 actually
// shipped: all four channels already fan out in parallel at T+0.
// Re-sequencing them into staggered first sends would DELAY the
// first SMS/WhatsApp delivery to make the ladder look like the
// diagram — worse for a real emergency. So D10's ladder escalates
// ON TOP of the parallel fan-out, and only while nobody has
// confirmed: the ladder stops the moment 2 distinct contacts ACK
// (plan §6 F1: "jab tak kam-se-kam 2 contacts ACK na karein").
//
//   Step 1 (+30s): re-fire only the channels that failed/partialled.
//   Step 2 (+60s): re-fire the still-failed channels once more.
//   Step 3 (+120s): Bolna voice call to contacts who have not ACKed.
//
// Timers are QStash delayed callbacks to POST /escalate (amendment
// A2 — no in-process timers on serverless). Scheduling happens at
// SOS time for all three steps; each callback re-checks the stop
// conditions before sending anything, so a late ACK or a closed
// alert never gets re-spammed. A re-fire is channel-level: a partial
// channel's already-delivered contacts may get a duplicate — the
// lesser evil against silence, stated here and in the report, not
// hidden. Voice calls are per-contact, so acked contacts ARE
// excluded there (unackedContacts).
//
// Callback auth reuses the D4 HMAC pattern with its own domain
// string ("escalation:<id>:<step>"), so a retry token cannot be
// replayed as an escalation token and vice versa.
const crypto = require("crypto");
const { normalizePhone } = require("./sms");
const { ackKeyFor, countingAcks } = require("./alertLifecycle");
const { publishDelayed } = require("./qstash");
const { publicBaseUrl } = require("./delivery");

const ACK_THRESHOLD = 2;
const ESCALATION_STEPS = [
  { step: 1, delaySeconds: 30, action: "refire-failed-channels" },
  { step: 2, delaySeconds: 60, action: "refire-failed-channels" },
  { step: 3, delaySeconds: 120, action: "voice-call" },
];

const escalationToken = (alertId, step) => {
  const secret = process.env.API_SECRET || "";
  if (!secret || typeof alertId !== "string" || !alertId || !Number.isInteger(step)) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`escalation:${alertId}:${step}`)
    .digest("hex");
};

const verifyEscalationToken = (alertId, step, token) => {
  const expected = escalationToken(alertId, step);
  if (!expected || typeof token !== "string") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// The ladder runs only while the alert is live (delivered, or acked
// but below threshold) and fewer than ACK_THRESHOLD distinct contacts
// have acknowledged. Only COUNTING acks stop it (services/
// alertLifecycle.js): a fabricated identifier is rejected at the ack
// route, and an anonymous ack never counts. A failed alert is the D4
// retry chain's job — the ladder must never re-fire it (that would
// double-send with the retry). Created/dispatching/closed never
// escalate.
const shouldEscalate = (alert) => {
  if (!alert || (alert.state !== "delivered" && alert.state !== "acked")) return false;
  return countingAcks(alert).length < ACK_THRESHOLD;
};

// Channels worth re-firing: failed, or partial (some contacts got
// it, some did not). Delivered channels are left alone.
const failedChannels = (receipts) => {
  if (!Array.isArray(receipts)) return [];
  return receipts
    .filter((r) => r.state === "failed" || r.state === "partial")
    .map((r) => r.channel)
    .filter(Boolean);
};

// Contacts the voice step should still call: valid, deduped phones,
// minus anyone whose ack key matches an ack already recorded. A
// contact who acked without an identifier (view-page form left
// blank) cannot be excluded — they get the call; the form asks for
// the number precisely so this exclusion works.
const unackedContacts = (alert, contacts) => {
  const acked = new Set((Array.isArray(alert?.acks) ? alert.acks : []).map((a) => a.key));
  const seen = new Set();
  const out = [];
  for (const c of (Array.isArray(contacts) ? contacts : []).slice(0, 10)) {
    const phone = normalizePhone(c?.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    if (acked.has(ackKeyFor({ phone }))) continue;
    out.push({
      phone,
      ...(typeof c?.name === "string" && c.name ? { name: c.name.slice(0, 60) } : {}),
    });
  }
  return out;
};

// Schedules all three ladder steps as QStash delayed jobs to POST
// /escalate. The job body carries the original SOS message + contact
// phones/pushTokens (same pairing as D7/D9 retries: phones[i] ↔
// pushTokens[i], empty placeholders preserve the pairing). Returns
// {steps: [{step, delaySeconds, queued, reason?}]} — callers must
// surface queued:false, never treat it as scheduled (qstash.js).
const scheduleEscalation = async ({ alertId, message, contacts = [] } = {}) => {
  const base = publicBaseUrl();
  const tokenFor = (step) => escalationToken(alertId, step);
  const pairs = (Array.isArray(contacts) ? contacts : [])
    .slice(0, 10)
    .map((c) => ({
      phone: typeof c?.phone === "string" ? c.phone.slice(0, 20) : "",
      pushToken: typeof c?.pushToken === "string" ? c.pushToken.slice(0, 1024) : "",
    }))
    .filter((p) => p.phone || p.pushToken);
  const steps = await Promise.all(
    ESCALATION_STEPS.map(async ({ step, delaySeconds }) => {
      const token = tokenFor(step);
      if (!token) return { step, delaySeconds, queued: false, reason: "no-signing-secret" };
      if (!base) return { step, delaySeconds, queued: false, reason: "no-public-url" };
      if (typeof message !== "string" || message.length === 0) {
        return { step, delaySeconds, queued: false, reason: "no-message" };
      }
      // The three jobs are independent — publish in parallel so a slow
      // QStash does not hold the SOS response three timeouts long.
      const res = await publishDelayed({
        url: `${base}/escalate`,
        body: {
          alertId,
          step,
          token,
          message,
          contacts: pairs.map((p) => p.phone),
          pushTokens: pairs.map((p) => p.pushToken),
        },
        delaySeconds,
        deduplicationId: `escalation:${alertId}:${step}`,
      });
      return res.queued
        ? { step, delaySeconds, queued: true }
        : { step, delaySeconds, queued: false, reason: res.reason || "publish-failed" };
    })
  );
  return { steps };
};

module.exports = {
  ACK_THRESHOLD,
  ESCALATION_STEPS,
  escalationToken,
  verifyEscalationToken,
  shouldEscalate,
  failedChannels,
  unackedContacts,
  scheduleEscalation,
};
