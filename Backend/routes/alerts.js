// 🚨 Alert routes — SOS dispatch, live tracking, and the debug test alert.
//
// Guard matrix (explicit, in one place): every mutating route here is
// API-key gated + rate-limited. requireApiKey audits rejected keys, so a
// brute-force walk leaves a trail.
const express = require("express");
const requireApiKey = require("../middleware/requireApiKey");
const { sosLimiter, trackingLimiter, testLimiter } = require("../middleware/rateLimit");
const {
  isValidLatitude,
  isValidLongitude,
  toNumber,
  sanitizeText,
} = require("../lib/validate");
const { buildSosMessage, dispatchSos } = require("../services/sos");
const { sendTelegramMessage } = require("../services/telegram");
const { audit } = require("../services/audit");

const router = express.Router();

// 🚨 SOS ALERT
// Rate-limited (30/15min per IP — see middleware/rateLimit.js for why
// the ceiling is generous: carrier NAT shares IPs and emergencies get
// repeat presses) + API-key gated. Coordinates are strictly validated;
// free-text fields are sanitized before they reach Telegram and logs.
router.post("/alert", sosLimiter, requireApiKey, async (req, res) => {
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

  const message = buildSosMessage({
    name,
    phone,
    battery,
    status,
    nearestStation,
    lat: latNum,
    lng: lngNum,
    contacts,
  });

  try {
    // AWAIT delivery before answering. On Vercel serverless the function
    // can freeze as soon as the response is sent, so the old
    // fire-and-forget call often died before Telegram received anything —
    // while the app still showed "Alert Sent". Success now means Telegram
    // actually accepted the message for at least one configured chat.
    const { sent, failed } = await dispatchSos(message);
    console.log(`📨 SOS for ${name} at ${latNum},${lngNum}: telegram sent=${sent} failed=${failed}`);
    // Audit: counts + contact count only — no PII (names, phones,
    // coordinates, message text) ever lands in an audit line.
    audit("alert.dispatched", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { sent, failed, contacts: contacts.length },
    });
    if (sent === 0) {
      return res
        .status(502)
        .json({ success: false, error: "Alert could not be delivered. Please try again." });
    }
    res.json({ success: true, message: "Alert delivered successfully" });
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
router.post("/location-update", trackingLimiter, requireApiKey, async (req, res) => {
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
      // Same contract as /alert: a delivery failure is a 502, not a
      // 200 — clients that check the HTTP status must not read a total
      // failure as delivered.
      return res
        .status(502)
        .json({ success: false, error: "Location update could not be delivered." });
    }

    console.log("📡 Live location sent");

    res.json({ success: true });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.status(502).json({ success: false, error: "Location update could not be delivered." });
  }
});

// 🧪 TEST ALERT (for debugging)
// Rate-limited (10/hour per IP — debugging only, no reason to hammer it).
// Debug endpoints stay OFF in production: every hit spams the user's
// Telegram emergency chats, so a forgotten test route is an abuse vector.
// Re-enable on a staging deploy with ENABLE_TEST_ALERT=1.
const testAlertGate = (req, res, next) => {
  // Default-deny: the route is OFF unless explicitly enabled, whatever
  // NODE_ENV says — a deploy where NODE_ENV is unset/different must not
  // silently re-expose a debug endpoint.
  if (process.env.ENABLE_TEST_ALERT !== "1") {
    // Audit the probe: someone is knocking on a debug endpoint.
    audit("test_alert.denied", { actorKey: req.header("x-api-key"), ip: req.ip });
    return res.status(404).json({ success: false, error: "Not found" });
  }
  next();
};
router.post("/test-alert", testAlertGate, testLimiter, requireApiKey, async (req, res) => {
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
      audit("test_alert.failed", {
        actorKey: req.header("x-api-key"),
        ip: req.ip,
        meta: { failed },
      });
      return res.status(500).json({ success: false, error: "Failed to send test alert" });
    }
    console.log("✅ TEST ALERT SENT");
    audit("test_alert.sent", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { sent },
    });
    res.json({ success: true, message: "Test alert sent successfully" });
  } catch (err) {
    console.log("❌ TEST ERROR:", err.message);
    // Generic message: err.message can carry Telegram/axios internals
    // (same policy as POST /alert's "Failed to send test alert").
    res.status(500).json({ success: false, error: "Failed to send test alert" });
  }
});

module.exports = router;
