const express = require("express");
const axios = require("axios");
const requireApiKey = require("./middleware/requireApiKey");
const helmet = require("helmet");

const app = express();

// 🔒 Security headers. CSP off: this is a JSON API, no HTML is served.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// ✅ CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

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
const sendTelegramMessage = async (message) => {
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.log("⚠️ Telegram disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS.");
    return;
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
      }
    } catch (err) {
      console.log(`❌ Failed for ${chat_id}:`, err.response?.data?.description || err.message);
    }
  }
};

// 🚨 SOS ALERT
app.post("/alert", requireApiKey, async (req, res) => {
  const { lat, lng, name, phone, battery, status, nearestStation } = req.body;

  if (!lat || !lng) {
    return res.json({ success: false, error: "Missing location data" });
  }

  const message = `🚨 EMERGENCY SOS ALERT 🚨

Name: ${name || "Unknown User"}
Phone: ${phone || "Not Provided"}

⚠️ I AM IN DANGER. PLEASE HELP IMMEDIATELY.

📍 STATIC LOCATION (Captured at SOS Trigger):
https://maps.google.com/?q=${lat},${lng}

📡 LIVE LOCATION TRACKING (Real-Time Updates):
https://maps.google.com/?q=${lat},${lng}

🕒 Time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} | ${new Date().toLocaleDateString('en-GB')}

🚶 Status: ${status || "Stationary"}
🔋 Battery: ${battery || "Unknown"}%

🚓 Nearest Police Station:
${nearestStation || "Searching nearest station..."}

🎥 Audio/Video recording started (if enabled)

🔴 This is an automated alert from Safety AI App.`;

  try {
    // 🔥 Fire-and-forget or run in background to respond faster to the user
    // We initiate the sending but don't await BEFORE responding success
    sendTelegramMessage(message).catch(err => console.log("🔥 Telegram Background Error:", err.message));

    console.log("✅ SOS ALERT INITIATED for:", name, "at", lat, lng);

    // 🚀 Respond immediately!
    res.json({ success: true, message: "Alert initiated successfully" });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📡 LIVE LOCATION UPDATE
app.post("/location-update", requireApiKey, async (req, res) => {
  const { lat, lng } = req.body;

  const message = `📡 LIVE TRACKING UPDATE
📍 https://maps.google.com/?q=${lat},${lng}`;

  try {
    await sendTelegramMessage(message);

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
app.post("/test-alert", requireApiKey, async (req, res) => {
  const testLat = "28.6139";
  const testLng = "77.2090";
  const message = `🧪 TEST ALERT!
📍 Location: https://maps.google.com/?q=${testLat},${testLng}
⏰ Time: ${new Date().toLocaleString()}
🔗 This is a test message from SafeLife AI`;

  try {
    await sendTelegramMessage(message);
    console.log("✅ TEST ALERT SENT");
    res.json({ success: true, message: "Test alert sent successfully" });
  } catch (err) {
    console.log("❌ TEST ERROR:", err.message);
    res.status(500).json({ success: false, error: err.message });
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