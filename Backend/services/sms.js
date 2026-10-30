// 📱 SMS channel service — SafeLife 2.0 Day 7 (plan §6 D7, amended A6).
//
// httpSMS (httpsms.com): the user's own Android phone, running the
// httpSMS app, acts as the SMS gateway. This server POSTs to
// https://api.httpsms.com/v1/messages/send with an x-api-key header;
// the service pushes the job to the gateway phone, which sends it via
// carrier SMS. Consequences, stated plainly:
// - The RECIPIENT needs only cellular signal, not mobile data — that
//   is the data-off property this channel buys (plan scenario S2).
// - The GATEWAY phone itself needs data for the push delivery, and
//   the server needs internet to reach the API. "SMS works with no
//   data anywhere" would be a lie; the no-data-anywhere path on the
//   victim's phone stays the app's manual SEND VIA SMS button plus
//   the D5 offline outbox, not this adapter.
// - A 2xx from the API means httpSMS ACCEPTED the message for the
//   gateway phone, not that the carrier delivered it to the handset —
//   the same accepted-not-confirmed semantics as the Telegram adapter
//   (Telegram's ok:true). No delivery-receipt API is claimed.
//
// Config (server-side only, never in the app): HTTPSMS_API_KEY from the
// httpsms.com dashboard, HTTPSMS_FROM = the gateway phone's own number.
// Without both, every send honestly reports channel-not-configured —
// the same reason string D4's stub used, so the D6 simulation suite
// and the app's status copy keep meaning what they meant.
// Phones are validated, deduplicated, and never logged in full.
const HTTPSMS_URL = "https://api.httpsms.com/v1/messages/send";

// Strip spaces, dashes, parens; keep an optional leading +. Valid =
// 10–15 digits (E.164 range without forcing the + — contacts arrive
// from the app's contact picker in whatever form the user stored).
const normalizePhone = (phone) => {
  if (typeof phone !== "string") return "";
  const cleaned = phone.replace(/[\s\-()]/g, "");
  return /^\+?\d{10,15}$/.test(cleaned) ? cleaned : "";
};

const smsConfig = () => ({
  apiKey: process.env.HTTPSMS_API_KEY || "",
  from: (process.env.HTTPSMS_FROM || "").trim(),
});

// Config-status for /health — booleans only, never secret values.
const smsStatus = () => {
  const { apiKey, from } = smsConfig();
  return { configured: Boolean(apiKey && from) };
};

// One SMS to one recipient. Never throws: every failure mode returns a
// counted failure with a reason, so one bad number cannot kill the
// rest of the fan-out (delivery.js enforces the same contract).
const sendSms = async ({ to, content, fetchImpl = fetch } = {}) => {
  const { apiKey, from } = smsConfig();
  if (!apiKey || !from) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const recipient = normalizePhone(to);
  if (!recipient) {
    return { sent: 0, failed: 1, reason: "invalid-phone" };
  }
  if (typeof content !== "string" || content.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  try {
    const res = await fetchImpl(HTTPSMS_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipient, content }),
      // The SOS request awaits fan-out; a stalled gateway API must fail
      // fast, not hang the alert until Vercel kills the function.
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) return { sent: 1, failed: 0 };
    console.log("❌ httpSMS rejected message: HTTP", res.status);
    return { sent: 0, failed: 1, reason: "sms-rejected" };
  } catch (err) {
    console.log("❌ httpSMS send failed:", err.name || "transport-error");
    return { sent: 0, failed: 1, reason: "sms-transport-error" };
  }
};

// Fan-out over the alert's emergency contacts: one SMS per distinct
// valid phone. Counts are per contact, which is what turns the
// channel receipt into the per-contact groundwork D4 deferred ("the
// first channel with per-contact addresses"). No full phone number
// ever leaves this module — logs carry counts only.
const sendSmsAlert = async ({ message, contacts = [], fetchImpl = fetch } = {}) => {
  if (!smsStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const phones = [...new Set(
    (Array.isArray(contacts) ? contacts : [])
      .slice(0, 10)
      .map((c) => normalizePhone(c?.phone))
      .filter(Boolean)
  )];
  if (phones.length === 0) {
    return { sent: 0, failed: 1, reason: "no-sms-recipients" };
  }
  const results = await Promise.all(
    phones.map((to) => sendSms({ to, content: message, fetchImpl }))
  );
  const sent = results.reduce((n, r) => n + r.sent, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const out = { sent, failed };
  if (sent === 0) {
    // All failed: surface the dominant reason so the status UI and the
    // operator can tell "gateway down" from "bad numbers" at a glance.
    out.reason = results[0].reason || "sms-failed";
  }
  return out;
};

module.exports = { normalizePhone, smsStatus, sendSms, sendSmsAlert };
