// 🔋 Battery alerts — SafeLife 2.0 Day 11 (plan §6 D11, plan §2 S1).
//
// A dying phone is a safety event, not an SOS: at 15% the app warns
// the user's contacts with its last location, and at 5% during an
// active alert it sends one final location burst before the phone
// can die. Both ride the D4 delivery fan-out, but neither creates
// an SOS alert record, schedules the D10 escalation ladder, or
// queues a D4 retry — a battery warning must never trigger voice
// calls or re-fire as if the user were in danger.
//
// Thresholds live here for the server and in
// mobile-app/utils/batteryAlerts.ts for the app (the two runtimes
// cannot share a module). Change both, in the same commit.
const LOW_BATTERY_THRESHOLD = 15;
const FINAL_BATTERY_THRESHOLD = 5;
// Above this level a discharge cycle is considered over: the app
// clears its already-sent flag, so a later drain warns again.
const REARM_LEVEL = 20;

// Pure firing decision. Inputs are the app's own readings:
// `charging` is true when plugged in, false when discharging, null
// when the OS cannot say (emulator/unknown) — unknown never blocks,
// or a warning could never fire on a device that cannot report state.
// `lowSent`/`finalSent` are the app's dedupe flags: without them the
// battery listener would warn on every 1% step below the threshold.
// Final beats low, and only while an alert is active: 5% with no
// alert is still just a low-battery warning. While an alert IS
// active, a low warning is suppressed entirely — contacts already
// hold an SOS, and a message saying "NOT an SOS" mid-emergency
// would confuse them; the final burst at 5% is the only battery
// message they get.
const decideBatteryAlert = ({ level, charging, alertActive, lowSent, finalSent } = {}) => {
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 100) return null;
  if (charging === true) return null;
  if (alertActive) {
    return level <= FINAL_BATTERY_THRESHOLD && !finalSent ? "final" : null;
  }
  return level <= LOW_BATTERY_THRESHOLD && !lowSent ? "low" : null;
};

// Server-side band check: the kind the app claims must match the
// level it reports, or a spoofed/buggy client could send a
// "phone may die" message at 90%. The route 400s a mismatch.
const isBatteryLevelInBand = (kind, level) => {
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 100) return false;
  if (kind === "low") return level <= LOW_BATTERY_THRESHOLD;
  if (kind === "final") return level <= FINAL_BATTERY_THRESHOLD;
  return false;
};

// Builds the battery-alert text. All free-text fields MUST be
// sanitized by the caller (lib/validate.js) — this function trusts
// its inputs, exactly like services/sos.js. The low message never
// claims danger: contacts must not rush out for a flat battery.
const buildBatteryMessage = ({
  kind = "low",
  name = "Unknown User",
  phone = "Not Provided",
  battery = "Unknown",
  lat,
  lng,
  contacts = [],
  viewUrl = "",
  when = new Date(),
}) => {
  const contactsSection = contacts.length
    ? `\n\n👥 Emergency contacts selected by user:\n${contacts
        .map((c) => `• ${c.name || "Unknown"} — ${c.phone || "No phone"}`)
        .join("\n")}`
    : "";
  if (kind === "final") {
    return `🔋 FINAL LOCATION — BATTERY CRITICAL 🔋

Name: ${name}
Phone: ${phone}

⚠️ An SOS alert is ACTIVE and my phone battery is at ${battery}% — the phone may die at any moment. This is my final location:

📍 LAST KNOWN LOCATION:
https://maps.google.com/?q=${lat},${lng}${viewUrl ? `

🔗 LIVE ALERT PAGE (no app needed — live location in your browser):
${viewUrl}` : ""}

🕒 Time: ${when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | ${when.toLocaleDateString('en-GB')}

🔋 Battery: ${battery}%${contactsSection}

🔴 This is an automated alert from Safety AI App.`;
  }
  return `🔋 LOW BATTERY WARNING 🔋

Name: ${name}
Phone: ${phone}

⚠️ My phone battery is low (${battery}%). This is NOT an SOS — I am sharing my last known location in case my phone dies:

📍 LAST KNOWN LOCATION:
https://maps.google.com/?q=${lat},${lng}

🕒 Time: ${when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | ${when.toLocaleDateString('en-GB')}

🔋 Battery: ${battery}%${contactsSection}

🔴 This is an automated alert from Safety AI App.`;
};

module.exports = {
  LOW_BATTERY_THRESHOLD,
  FINAL_BATTERY_THRESHOLD,
  REARM_LEVEL,
  decideBatteryAlert,
  isBatteryLevelInBand,
  buildBatteryMessage,
};
