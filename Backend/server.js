const express = require("express");
const axios = require("axios");
const requireApiKey = require("./middleware/requireApiKey");
const { sosLimiter, trackingLimiter, testLimiter } = require("./middleware/rateLimit");
const corsMiddleware = require("./middleware/cors");
const {
  isValidLatitude,
  isValidLongitude,
  toNumber,
  sanitizeText,
} = require("./lib/validate");
const helmet = require("helmet");

const app = express();

// 🔒 Security headers. CSP off: this is a JSON API, no HTML is served.
app.use(helmet({ contentSecurityPolicy: false }));
// 🛡️ Cap body size — SOS payloads are tiny; oversized bodies are abuse.
app.use(express.json({ limit: "32kb" }));

// 🌐 Trust the first proxy hop (Vercel's edge / local reverse proxies) so
// req.ip — and therefore rate limiting — sees the real client IP. Without
// this, every user shares one rate-limit bucket.
app.set("trust proxy", 1);

// 🔒 CORS — allowlisted origins only (see middleware/cors.js). With
// CORS_ALLOWED_ORIGINS unset this emits no CORS headers at all (fail
// closed): cross-site browser calls are blocked, the native app — which
// sends no Origin — is unaffected.
app.use(corsMiddleware);

// 🔐 Telegram config — secrets come from the environment, never from code.
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS in the hosting dashboard
// (Vercel → Project → Settings → Environment Variables).
// NOTE: a bot token was previously hardcoded in this public repo's history —
// rotate it via BotFather; the code no longer embeds any credential.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// 👇 Recipient chat IDs — comma-separated, from the environment.
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 🔥 COMMON SEND FUNCTION
// Returns { sent, failed } per chat so callers can answer honestly.
// Previously delivery failures were only logged and every caller reported
// success — which made /test-alert useless as a config check (it exists
// precisely to answer "is my Telegram wiring working?").
const sendTelegramMessage = async (message) => {
  const result = { sent: 0, failed: 0 };
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.log("⚠️ Telegram disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS.");
    result.failed = 1;
    return result;
  }
  for (let chat_id of CHAT_IDS) {
    try {
      const resp = await axios.post(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          chat_id,
          text: message,
        }
      );
      if (resp.data.ok) {
        console.log(`✅ Message successfully sent to Telegram ID: ${chat_id}`);
        result.sent += 1;
      } else {
        console.log(`❌ Telegram rejected message for ${chat_id}:`, resp.data.description);
        result.failed += 1;
      }
    } catch (err) {
      console.log(`❌ Failed for ${chat_id}:`, err.response?.data?.description || err.message);
      result.failed += 1;
    }
  }
  return result;
};

// 🚨 SOS ALERT
// Rate-limited (5/15min per IP — each hit spams the user's Telegram
// contacts) + API-key gated. Coordinates are strictly validated; free-text
// fields are sanitized before they reach the Telegram message and logs.
app.post("/alert", sosLimiter, requireApiKey, async (req, res) => {
  const { lat, lng } = req.body;

  // Reject garbage coordinates (non-numeric, out of range). The app blocks
  // SOS before a GPS fix client-side; this is the server-side backstop —
  // a maps link with "Loading..." or 9999 in it helps nobody.
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ success: false, error: "Invalid location data" });
  }
  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);

  const name = sanitizeText(req.body.name, 100) || "Unknown User";
  const phone = sanitizeText(req.body.phone, 30) || "Not Provided";
  const battery = sanitizeText(req.body.battery, 10) || "Unknown";
  const status = sanitizeText(req.body.status, 50) || "Stationary";
  const nearestStation = sanitizeText(req.body.nearestStation, 200) || "Searching nearest station...";

  // 👥 Optional emergency contacts picked by the user in the app's
  // Contacts tab and sent with the SOS. Capped at 10 and sanitized like
  // every other field; listed in the message so the Telegram receiver
  // can see who else the user chose to alert.
  const contacts = (Array.isArray(req.body.contacts) ? req.body.contacts : [])
    .slice(0, 10)
    .map((c) => ({
      name: sanitizeText(c?.name, 60),
      phone: sanitizeText(c?.phone, 20),
    }))
    .filter((c) => c.name || c.phone);
  const contactsSection = contacts.length
    ? `\n\n👥 Emergency contacts selected by user:\n${contacts
        .map((c) => `• ${c.name || "Unknown"} — ${c.phone || "No phone"}`)
        .join("\n")}`
    : "";

  const message = `🚨 EMERGENCY SOS ALERT 🚨

Name: ${name}
Phone: ${phone}

⚠️ I AM IN DANGER. PLEASE HELP IMMEDIATELY.

📍 STATIC LOCATION (Captured at SOS Trigger):
https://maps.google.com/?q=${latNum},${lngNum}

📡 LIVE LOCATION TRACKING (Real-Time Updates):
https://maps.google.com/?q=${latNum},${lngNum}

🕒 Time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | ${new Date().toLocaleDateString('en-GB')}

🚶 Status: ${status}
🔋 Battery: ${battery}%

🚓 Nearest Police Station:
${nearestStation}${contactsSection}

🎥 Audio/Video recording started (if enabled)

🔴 This is an automated alert from Safety AI App.`;

  try {
    // 🔥 Fire-and-forget or run in background to respond faster to the user
    // We initiate the sending but don't await BEFORE responding success
    sendTelegramMessage(message).catch(err => console.log("🔥 Telegram Background Error:", err.message));

    console.log("✅ SOS ALERT INITIATED for:", name, "at", latNum, lngNum);

    // 🚀 Respond immediately!
    res.json({ success: true, message: "Alert initiated successfully" });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    // Generic message — err.message can leak internals (Telegram API
    // errors, stack fragments). Details stay in the server logs.
    res.status(500).json({ success: false, error: "Failed to send alert" });
  }
});

// 📡 LIVE LOCATION UPDATE
// Rate-limited (60/min per IP — live tracking updates every few seconds)
// + API-key gated. Coordinates strictly validated like /alert.
app.post("/location-update", trackingLimiter, requireApiKey, async (req, res) => {
  const { lat, lng } = req.body;

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ success: false, error: "Invalid location data" });
  }
  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);

  const message = `📡 LIVE TRACKING UPDATE
📍 https://maps.google.com/?q=${latNum},${lngNum}`;

  try {
    const { sent } = await sendTelegramMessage(message);
    if (sent === 0) {
      console.log("❌ Live location failed for all recipients");
      return res.json({ success: false });
    }

    console.log("📡 Live location sent");

    res.json({ success: true });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.json({ success: false });
  }
});

// 🏠 ROOT — friendly status page (so the URL doesn't look broken)
app.get("/", (req, res) => {
  res.json({
    service: "SafeLife AI — Emergency Backend",
    status: "online",
    time: new Date().toISOString(),
    endpoints: {
      health: "GET /health",
      alert: "POST /alert",
      locationUpdate: "POST /location-update",
      testAlert: "POST /test-alert",
    },
  });
});

// ❤️ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
  });
});

// 🧪 TEST ALERT (for debugging)
// Rate-limited (10/hour per IP — debugging only, no reason to hammer it).
// Debug endpoints stay OFF in production: every hit spams the user's
// Telegram emergency chats, so a forgotten test route is an abuse vector.
// Re-enable on a staging deploy with ENABLE_TEST_ALERT=1.
const testAlertGate = (req, res, next) => {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_TEST_ALERT !== "1") {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  next();
};
app.post("/test-alert", testAlertGate, testLimiter, requireApiKey, async (req, res) => {
  const testLat = "28.6139";
  const testLng = "77.2090";
  const message = `🧪 TEST ALERT!
📍 Location: https://maps.google.com/?q=${testLat},${testLng}
⏰ Time: ${new Date().toLocaleString()}
🔗 This is a test message from SafeLife AI`;

  try {
    const { sent, failed } = await sendTelegramMessage(message);
    if (sent === 0) {
      // All deliveries failed (bad token, bad chat IDs, Telegram down,
      // or Telegram not configured) — say so instead of reporting
      // success. Details stay in the server logs, never the response.
      console.log(`❌ TEST ALERT FAILED for all recipients (failed=${failed})`);
      return res.status(500).json({ success: false, error: "Failed to send test alert" });
    }
    console.log("✅ TEST ALERT SENT");
    res.json({ success: true, message: "Test alert sent successfully" });
  } catch (err) {
    console.log("❌ TEST ERROR:", err.message);
    // Generic message: err.message can carry Telegram/axios internals
    // (same policy as POST /alert's "Failed to send alert").
    res.status(500).json({ success: false, error: "Failed to send test alert" });
  }
});

// 🚀 START SERVER (local dev only — Vercel uses api/index.js instead)
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Server running on port " + PORT);
  });
}

module.exports = app;