// 📲 WhatsApp channel service — SafeLife 2.0 Day 8 (plan §6 D8, amended A6).
//
// WhatsApp Business Cloud API (Meta Graph API v23.0): this server POSTs
// to https://graph.facebook.com/v23.0/{phone-number-id}/messages with a
// Bearer access token. Consequences, stated plainly:
// - Business-initiated messages outside the 24-hour customer-service
//   window MUST be approved templates — free-form text is rejected.
//   An SOS goes to contacts who have not messaged the business, so
//   this adapter always sends a template, never free-form text.
// - The template is created and approved in Meta's dashboard by
//   Rishabh (business verification is his D8 step, still outstanding).
//   The adapter therefore sends the template with NO parameters: the
//   template body must be parameterless (see .env.example for the exact
//   wording to create). Guessing parameter names/counts would make
//   the first live send fail on a template mismatch — if the approved
//   template DOES carry {{n}} variables, Meta rejects this send and
//   the receipt honestly says whatsapp-rejected; adding parameters is
//   a live-turn change made against the real approved template, not
//   a guess baked in now. The WhatsApp message is a ping ("check
//   SMS/Telegram, call now") — the location itself travels on the
//   SMS and Telegram channels, which carry full text.
// - A 2xx from Meta means the message was ACCEPTED, not delivered or
//   read. Confirmed delivery/read arrives only via webhooks (no
//   webhook receiver in this program); nothing here claims more.
// - Recipients must have opted in to business messages, and the
//   sending number must be a verified WhatsApp Business number.
//   Sending from a personal number is not possible and is not
//   attempted (plan §7 honest limit 1).
//
// Config (server-side only, never in the app): WHATSAPP_ACCESS_TOKEN
// (permanent System User token), WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANGUAGE (default en_US).
// Without token + phone-number id + template name, every send honestly
// reports channel-not-configured — the same reason string D4's stub
// used, so the D6 simulation suite keeps meaning what it meant.
// Phones are validated, deduplicated, and never logged in full.
const { normalizePhone } = require("./sms");

const whatsappConfig = () => ({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
  phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim(),
  templateName: (process.env.WHATSAPP_TEMPLATE_NAME || "").trim(),
  language: (process.env.WHATSAPP_TEMPLATE_LANGUAGE || "").trim() || "en_US",
});

// Config-status for /health — booleans only, never secret values.
const whatsappStatus = () => {
  const { accessToken, phoneNumberId, templateName } = whatsappConfig();
  return { configured: Boolean(accessToken && phoneNumberId && templateName) };
};

// Meta wants the recipient in E.164 without the leading + (its own
// examples use 16505555555, and its success payload echoes `input`
// without a +). normalizePhone (shared with SMS) keeps the +; strip
// it here, at the WhatsApp boundary only.
const whatsappRecipient = (phone) => normalizePhone(phone).replace(/^\+/, "");

// One template message to one recipient. Never throws: every failure
// mode returns a counted failure with a reason, so one bad number
// cannot kill the rest of the fan-out (delivery.js enforces the same
// contract).
const sendWhatsApp = async ({ to, fetchImpl = fetch } = {}) => {
  const { accessToken, phoneNumberId, templateName, language } = whatsappConfig();
  if (!accessToken || !phoneNumberId || !templateName) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const recipient = whatsappRecipient(to);
  if (!recipient) {
    return { sent: 0, failed: 1, reason: "invalid-phone" };
  }
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "template",
          // No `components`: the template is parameterless by contract
          // (see header). Sending components for variables the approved
          // template does not have would be a rejection.
          template: {
            name: templateName,
            language: { code: language, policy: "deterministic" },
          },
        }),
        // The SOS request awaits fan-out; a stalled Graph API must fail
        // fast, not hang the alert until Vercel kills the function.
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) return { sent: 1, failed: 0 };
    console.log("❌ WhatsApp rejected message: HTTP", res.status);
    return { sent: 0, failed: 1, reason: "whatsapp-rejected" };
  } catch (err) {
    console.log("❌ WhatsApp send failed:", err.name || "transport-error");
    return { sent: 0, failed: 1, reason: "whatsapp-transport-error" };
  }
};

// Fan-out over the alert's emergency contacts: one template message
// per distinct valid phone. Counts are per contact, like SMS. No
// full phone number ever leaves this module — logs carry counts only.
const sendWhatsAppAlert = async ({ contacts = [], fetchImpl = fetch } = {}) => {
  if (!whatsappStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const phones = [...new Set(
    (Array.isArray(contacts) ? contacts : [])
      .slice(0, 10)
      .map((c) => normalizePhone(c?.phone))
      .filter(Boolean)
  )];
  if (phones.length === 0) {
    return { sent: 0, failed: 1, reason: "no-whatsapp-recipients" };
  }
  const results = await Promise.all(
    phones.map((to) => sendWhatsApp({ to, fetchImpl }))
  );
  const sent = results.reduce((n, r) => n + r.sent, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const out = { sent, failed };
  if (sent === 0) {
    // All failed: surface the dominant reason so the status UI and the
    // operator can tell "Meta rejected" from "bad numbers" at a glance.
    out.reason = results[0].reason || "whatsapp-failed";
  }
  return out;
};

module.exports = { whatsappConfig, whatsappStatus, whatsappRecipient, sendWhatsApp, sendWhatsAppAlert };
