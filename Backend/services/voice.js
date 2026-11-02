// 📞 Voice-call channel service — SafeLife 2.0 Day 10 (plan §6 D10,
// escalation ladder step 3: automated voice call at T+2min).
//
// Provider decision (recorded, overturnable): Bolna, not Twilio.
// Bolna is already connected in this workspace (custom.bolna, key
// live, agency voice-agent infra exists); Twilio would need a new
// account, number and cost line for the same job. If Rishabh picks
// Twilio, this adapter is the seam to replace — the ladder calls
// sendVoiceAlert, never Bolna directly.
//
// Bolna API shape verified against the connector client
// (~/workspace/custom-connectors/custom.bolna/bin/client.py, itself
// verified against Bolna's quickstart docs 2026-10-17): POST
// https://api.bolna.ai/call, Bearer key, body {agent_id,
// recipient_phone_number, user_data?}. A 2xx means Bolna ACCEPTED
// the call placement, not that anyone answered — call outcome lives
// in Bolna executions, which no webhook reads here.
//
// The agent does the talking, not this adapter: BOLNA_AGENT_ID must
// point at an SOS agent Rishabh creates in the Bolna dashboard whose
// prompt speaks the user_data.sos_message (see .env.example). Until
// that agent exists, pointing this at the agency sales agent would
// pitch a prospect script to an emergency contact — so the adapter
// stays unconfigured without BOTH vars, and no default agent is
// guessed. Trial accounts can only call dashboard-verified numbers;
// automated calls go only to the victim's own chosen contacts, who
// opted in by being emergency contacts — the first live call must
// still be a supervised test, never a real SOS.
//
// Config (server-side only, never in the app): BOLNA_API_KEY,
// BOLNA_AGENT_ID. Without both, every call honestly reports
// channel-not-configured — the same reason string D4's stub used.
// Phones are validated, deduplicated, and never logged in full.
const { normalizePhone } = require("./sms");

const BOLNA_CALL_URL = "https://api.bolna.ai/call";

const voiceConfig = () => ({
  apiKey: process.env.BOLNA_API_KEY || "",
  agentId: (process.env.BOLNA_AGENT_ID || "").trim(),
});

// Config-status for /health — booleans only, never secret values.
const voiceStatus = () => {
  const { apiKey, agentId } = voiceConfig();
  return { configured: Boolean(apiKey && agentId) };
};

// One voice call to one recipient. Never throws: every failure mode
// returns a counted failure with a reason, so one bad number cannot
// kill the rest of the escalation (delivery.js enforces the same
// contract for the other channels).
const sendVoiceCall = async ({ to, name, message, fetchImpl = fetch } = {}) => {
  const { apiKey, agentId } = voiceConfig();
  if (!apiKey || !agentId) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const recipient = normalizePhone(to);
  if (!recipient) {
    return { sent: 0, failed: 1, reason: "invalid-phone" };
  }
  if (typeof message !== "string" || message.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  const userData = { sos_message: message.slice(0, 1000) };
  if (typeof name === "string" && name.trim()) userData.recipient_name = name.trim().slice(0, 60);
  try {
    const res = await fetchImpl(BOLNA_CALL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        recipient_phone_number: recipient,
        user_data: userData,
      }),
      // Same 6s fail-fast timeout as the SMS/WhatsApp/push adapters:
      // the escalation callback must not hang until Vercel kills it.
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) return { sent: 1, failed: 0 };
    console.log("❌ Bolna rejected voice call: HTTP", res.status);
    return { sent: 0, failed: 1, reason: "voice-rejected" };
  } catch (err) {
    console.log("❌ Bolna voice call failed:", err.name || "transport-error");
    return { sent: 0, failed: 1, reason: "voice-transport-error" };
  }
};

// Voice fan-out over the alert's emergency contacts: one call per
// distinct valid phone. Counts are per contact. No full phone number
// ever leaves this module — logs carry counts only.
const sendVoiceAlert = async ({ message, contacts = [], fetchImpl = fetch } = {}) => {
  if (!voiceStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  if (typeof message !== "string" || message.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  const seen = new Set();
  const targets = [];
  for (const c of (Array.isArray(contacts) ? contacts : []).slice(0, 10)) {
    const phone = normalizePhone(c?.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    targets.push({ phone, name: typeof c?.name === "string" ? c.name : "" });
  }
  if (targets.length === 0) {
    return { sent: 0, failed: 1, reason: "no-voice-recipients" };
  }
  const results = await Promise.all(
    targets.map((t) => sendVoiceCall({ to: t.phone, name: t.name, message, fetchImpl }))
  );
  const sent = results.reduce((n, r) => n + r.sent, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const out = { sent, failed };
  if (sent === 0) {
    out.reason = results[0].reason || "voice-failed";
  }
  return out;
};

module.exports = { voiceConfig, voiceStatus, sendVoiceCall, sendVoiceAlert };
