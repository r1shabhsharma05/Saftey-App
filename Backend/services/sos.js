// 🚨 SOS service — alert message composition + dispatch.
//
// Pure builder (unit-testable) kept separate from delivery so the route
// handler stays thin: validate → sanitize → dispatch → respond.
const { sendTelegramMessage } = require("./telegram");

// Builds the Telegram SOS text. All free-text fields MUST be sanitized
// by the caller (lib/validate.js) — this function trusts its inputs.
const buildSosMessage = ({
  name = "Unknown User",
  phone = "Not Provided",
  battery = "Unknown",
  status = "Stationary",
  nearestStation = "Searching nearest station...",
  lat,
  lng,
  contacts = [],
  when = new Date(),
}) => {
  const contactsSection = contacts.length
    ? `\n\n👥 Emergency contacts selected by user:\n${contacts
        .map((c) => `• ${c.name || "Unknown"} — ${c.phone || "No phone"}`)
        .join("\n")}`
    : "";

  return `🚨 EMERGENCY SOS ALERT 🚨

Name: ${name}
Phone: ${phone}

⚠️ I AM IN DANGER. PLEASE HELP IMMEDIATELY.

📍 STATIC LOCATION (Captured at SOS Trigger):
https://maps.google.com/?q=${lat},${lng}

📡 LIVE LOCATION TRACKING (Real-Time Updates):
https://maps.google.com/?q=${lat},${lng}

🕒 Time: ${when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | ${when.toLocaleDateString('en-GB')}

🚶 Status: ${status}
🔋 Battery: ${battery}%

🚓 Nearest Police Station:
${nearestStation}${contactsSection}

🎥 Audio/Video recording started (if enabled)

🔴 This is an automated alert from Safety AI App.`;
};

// Sends the SOS over the Telegram channel (more channels join in Phase 2).
// Returns { sent, failed } — the caller decides what that means for HTTP.
const dispatchSos = (message) => sendTelegramMessage(message);

module.exports = { buildSosMessage, dispatchSos };
