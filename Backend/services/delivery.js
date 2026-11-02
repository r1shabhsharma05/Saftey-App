// 📨 Delivery engine — SafeLife 2.0 Day 4 (plan §6 D4, amended A2).
//
// v1 said BullMQ workers; production is Vercel serverless, so the shape
// is: fan-out stays request-scoped parallel sends (this module), and
// retries ride QStash delayed callbacks (D2 wiring) to POST
// /delivery-retry. No in-process timers — a frozen serverless instance
// cannot retry anything after the response is sent.
//
// Receipt granularity is per CHANNEL, not per contact: Telegram sends
// to fixed bot chat IDs. D7/D8/D9 add the exception: SMS, WhatsApp
// and push send per contact (phone / phone / device token), so their
// receipts' sent/failed counts ARE per-contact counts
// (services/sms.js, services/whatsapp.js, services/push.js). The
// per-contact confirmation tracking D4 deferred lands with D10's
// ACKs (services/alertLifecycle.js recordAck) + escalation ladder
// (services/escalation.js), not as receipt rows here.
//
// Retry policy: 3 attempts, backoff 30s → 120s → 300s, only on TOTAL
// failure (sent === 0). A partial delivery (Telegram accepted, other
// channels failed) is a delivered alert; retrying its failed channels
// is the D10 escalation ladder's job, not D4's.
//
// Callback auth: QStash cannot carry our x-api-key header, so the
// retry job body carries an HMAC token over (alertId, attempt) keyed
// by API_SECRET, verified with a timing-safe compare in the route.
// Without API_SECRET there is no signing key, so no retry is scheduled
// — an unsigned callback must never be able to re-fire an SOS.
const crypto = require("crypto");
const { dispatchSos } = require("./sos");
const { sendSmsAlert } = require("./sms");
const { sendWhatsAppAlert } = require("./whatsapp");
const { sendPushAlert } = require("./push");
const { publishDelayed } = require("./qstash");

const CHANNELS = ["telegram", "sms", "whatsapp", "push"];
const RETRY_DELAYS = [30, 120, 300];
const MAX_RETRIES = RETRY_DELAYS.length;

// Seconds to wait before retry attempt N (1-based); null past the last.
const nextRetryDelay = (attempt) => RETRY_DELAYS[attempt - 1] ?? null;

// Honest stub: a channel whose day has not landed reports failure with
// a reason, never fake success. All four channels are wired now
// (D7 SMS, D8 WhatsApp, D9 push); this stub survives only as the
// fallback shape for an injected-sender gap in tests.
const notConfigured = async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" });

const defaultSenders = {
  telegram: ({ message }) => dispatchSos(message),
  sms: ({ message, contacts }) => sendSmsAlert({ message, contacts }),
  whatsapp: ({ contacts }) => sendWhatsAppAlert({ contacts }),
  push: ({ message, contacts }) => sendPushAlert({ message, contacts }),
};

// Parallel fan-out over every channel. Never throws: a throwing adapter
// becomes a failed receipt, so one broken channel cannot kill the rest.
// Contacts flow through so per-contact channels (SMS, from D7) can
// address them; channel senders that ignore contacts (Telegram) are
// unaffected by the extra argument. D10: `channels` narrows the fan-out
// (the escalation ladder re-fires only failed/partial channels —
// re-sending a delivered channel would duplicate every contact's
// message); omitted means all four, as before.
const deliverAlert = async ({ message, contacts = [], senders = defaultSenders, channels = CHANNELS } = {}) => {
  const wanted = CHANNELS.filter((c) => channels.includes(c));
  const receipts = await Promise.all(
    wanted.map(async (channel) => {
      try {
        const r = await senders[channel]({ message, contacts });
        const sent = r.sent || 0;
        const failed = r.failed || 0;
        return {
          channel,
          state: sent > 0 ? (failed > 0 ? "partial" : "delivered") : "failed",
          sent,
          failed,
          attempts: 1,
          ...(r.reason ? { reason: r.reason } : {}),
        };
      } catch {
        return { channel, state: "failed", sent: 0, failed: 1, attempts: 1, reason: "transport-error" };
      }
    })
  );
  return receipts;
};

const receiptsSummary = (receipts) => ({
  sent: receipts.reduce((n, r) => n + r.sent, 0),
  failed: receipts.reduce((n, r) => n + r.failed, 0),
});

// A retry replaces each channel's receipt with its fresh result and
// bumps the attempt count, so GET /alert/:id always shows the latest
// state per channel plus how many times it was tried.
const applyRetryReceipts = (oldReceipts, freshReceipts) => {
  const oldByChannel = new Map((oldReceipts || []).map((r) => [r.channel, r]));
  return CHANNELS.map((channel) => {
    const fresh = freshReceipts.find((r) => r.channel === channel);
    if (!fresh) return oldByChannel.get(channel);
    const old = oldByChannel.get(channel);
    return { ...fresh, attempts: (old ? old.attempts : 0) + 1 };
  }).filter(Boolean);
};

const retryToken = (alertId, attempt) => {
  const secret = process.env.API_SECRET || "";
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(`${alertId}:${attempt}`).digest("hex");
};

const verifyRetryToken = (alertId, attempt, token) => {
  const expected = retryToken(alertId, attempt);
  if (!expected || typeof token !== "string") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Where QStash must POST back to: explicit PUBLIC_BASE_URL wins, else
// Vercel's own VERCEL_URL. Empty string = unknowable (local dev without
// a tunnel), and scheduling without a callback URL would silently drop
// the retry — so the caller gets queued:false instead.
const publicBaseUrl = () => {
  const explicit = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
};

// Queues retry attempt N for an alert. The job body carries the
// original SOS message: the callback instance cannot be assumed to
// share memory with the instance that took the SOS (serverless), and
// a retry without the location would be a neutered alert. The message
// travels only to our own callback, authenticated by the HMAC token.
// D7: contact phones ride along too (phones only, no names — the
// retry needs them to re-fire SMS; names would be PII the job does
// not need). D9: push tokens ride alongside, paired with their phone
// BY INDEX (phones[i] ↔ pushTokens[i]) — the retry route rebuilds
// contacts from the pair, so a token without a phone still re-fires
// push. Empty-string placeholders preserve the pairing when one side
// of a pair is absent; both adapters skip empty values. Returns
// { queued: true, ... } or { queued: false, reason } — callers must
// surface queued:false, never treat it as scheduled.
const scheduleRetry = async ({ alertId, attempt, message, contacts = [] }) => {
  const delay = nextRetryDelay(attempt);
  if (!delay) return { queued: false, reason: "no-more-retries" };
  const token = retryToken(alertId, attempt);
  if (!token) return { queued: false, reason: "no-signing-secret" };
  const base = publicBaseUrl();
  if (!base) return { queued: false, reason: "no-public-url" };
  if (typeof message !== "string" || message.length === 0) {
    return { queued: false, reason: "no-message" };
  }
  const pairs = (Array.isArray(contacts) ? contacts : [])
    .slice(0, 10)
    .map((c) => ({
      phone: typeof c?.phone === "string" ? c.phone.slice(0, 20) : "",
      pushToken: typeof c?.pushToken === "string" ? c.pushToken.slice(0, 1024) : "",
    }))
    .filter((p) => p.phone || p.pushToken);
  const res = await publishDelayed({
    url: `${base}/delivery-retry`,
    body: {
      alertId,
      attempt,
      token,
      message,
      contacts: pairs.map((p) => p.phone),
      pushTokens: pairs.map((p) => p.pushToken),
    },
    delaySeconds: delay,
    deduplicationId: `delivery-retry:${alertId}:${attempt}`,
  });
  return res.queued
    ? { queued: true, attempt, delaySeconds: delay }
    : { queued: false, reason: res.reason || "publish-failed" };
};

module.exports = {
  CHANNELS,
  RETRY_DELAYS,
  MAX_RETRIES,
  nextRetryDelay,
  defaultSenders,
  deliverAlert,
  receiptsSummary,
  applyRetryReceipts,
  retryToken,
  verifyRetryToken,
  publicBaseUrl,
  scheduleRetry,
};
