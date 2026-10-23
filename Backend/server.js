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
  // Parallel, not serial: awaiting chats one by one stacked an 8s
  // timeout per recipient inside the SOS request, and with Vercel's
  // default function cap the platform could kill /alert mid-flight —
  // the phone then saw a dropped connection instead of an answer.
  await Promise.all(
    CHAT_IDS.map(async (chat_id) => {
      try {
        const resp = await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          {
            chat_id,
            text: message,
          },
          // Axios's default timeout is 0 (never). /alert awaits delivery,
          // so a stalled Telegram API would hang the SOS request until
          // the platform kills the function — fail fast and honestly.
          { timeout: 6000 }
        );
        if (resp.data && resp.data.ok) {
          console.log(`✅ Message successfully sent to Telegram ID: ${chat_id}`);
          result.sent += 1;
        } else {
          console.log(`❌ Telegram rejected message for ${chat_id}:`, resp.data && resp.data.description);
          result.failed += 1;
        }
      } catch (err) {
        console.log(`❌ Failed for ${chat_id}:`, err.response?.data?.description || err.message);
        result.failed += 1;
      }
    })
  );
  return result;
};

// 🚨 SOS ALERT
// Rate-limited (30/15min per IP — see middleware/rateLimit.js for why
// the ceiling is generous: carrier NAT shares IPs and emergencies get
// repeat presses) + API-key gated. Coordinates are strictly validated;
// free-text fields are sanitized before they reach Telegram and logs.
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
    // AWAIT delivery before answering. On Vercel serverless the function
    // can freeze as soon as the response is sent, so the old
    // fire-and-forget call often died before Telegram received anything —
    // while the app still showed "Alert Sent". Success now means Telegram
    // actually accepted the message for at least one configured chat.
    const { sent, failed } = await sendTelegramMessage(message);
    console.log(`📨 SOS for ${name} at ${latNum},${lngNum}: telegram sent=${sent} failed=${failed}`);
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

// 🏠 ROOT — friendly status page (so the URL doesn't look broken)
app.get("/", (req, res) => {
  res.json({
    service: "SafeLife AI — Emergency Backend",
    status: "online",
    time: new Date().toISOString(),
    // No endpoint map here: this route is unauthenticated, and listing
    // every route (incl. the debug one) is free reconnaissance.
  });
});

// ❤️ HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
  });
});

// 🛡️ SAFE PLACES PROXY — the app used to query Overpass directly from
// the phone; on flaky mobile data those heavy queries timed out and
// Safe Hubs / Police Radar sat on an error. Server-side the same query
// runs from a fast network (Mumbai region), mirrors race with a bounded
// timeout, and results are cached per ~100m grid cell for 5 minutes —
// the phone gets one small, fast JSON response instead. The response
// keeps Overpass's shape ({ elements: [...] }) so the app's existing
// parser works unchanged.
const safePlacesCache = new Map();
app.get("/safe-places", trackingLimiter, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return res.status(400).json({ success: false, error: "Invalid coordinates" });
  }
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = safePlacesCache.get(key);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) {
    return res.json(hit.data);
  }
  const query =
    `[out:json][timeout:25];(nwr["amenity"="police"](around:20000,${lat},${lng});` +
    `nwr["amenity"~"hospital|clinic|mall|cafe|bank|pharmacy|university|college"](around:10000,${lat},${lng});` +
    `nwr["tourism"~"hostel|hotel"](around:10000,${lat},${lng});` +
    `nwr["shop"~"mall|supermarket|department_store"](around:10000,${lat},${lng}););out center 200;`;
  // Race both public mirrors in parallel and take the first good answer:
  // sequentially trying a slow mirror first burned the whole budget
  // (observed live 2026-10-23: kumi timing out after api.de failed ->
  // 502 for the user). Overpass also rejects requests with no UA.
  const mirrors = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];
  const fetchMirror = async (base) => {
    const resp = await axios.get(base, {
      params: { data: query },
      timeout: 20000,
      headers: {
        "User-Agent": "SafeLifeAI/1.0 (personal safety app)",
        Accept: "application/json",
      },
    });
    if (resp.data && Array.isArray(resp.data.elements)) return resp.data;
    throw new Error(`Unexpected Overpass response shape from ${base}`);
  };
  try {
    const data = await Promise.any(mirrors.map(fetchMirror));
    safePlacesCache.set(key, { ts: Date.now(), data });
    return res.json(data);
  } catch (err) {
    const msgs =
      err && err.errors
        ? err.errors.map((e) => e && e.message).join(" | ")
        : err && err.message;
    console.log("❌ SAFE-PLACES ERROR:", msgs);
    // Every mirror failed. If this grid cell was ever fetched
    // successfully, serve the stale copy instead of an error — for a
    // safety lookup, slightly old station data beats none.
    if (hit) return res.json(hit.data);
    return res.status(502).json({ success: false, error: "Safe places lookup failed" });
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

// 🚫 404 — every response from this API is JSON. Express's default 404
// is an HTML page ("Cannot POST /…"), which leaks framework details
// and breaks API clients expecting JSON.
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// 💥 Error handler — the catch-all for anything the routes didn't handle
// (malformed JSON from the body parser, oversized bodies, unexpected
// throws). Responses stay generic on purpose: err.message and stack
// traces can leak file paths and library internals, so details go to
// the server log ONLY. Client-caused errors keep their 4xx status
// (400 bad JSON, 413 body too large); everything else is a plain 500.
// (Express requires the 4-argument signature to treat this as an
// error handler — `next` is unused.)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 500
      ? err.status
      : 500;
  if (status === 500) {
    console.error("❌ Unhandled error:", err?.stack || err);
  } else {
    console.log(`⚠️ Rejected request (${status}):`, err?.type || err?.message);
  }
  return res.status(status).json({
    success: false,
    error: status === 500 ? "Internal server error" : "Invalid request",
  });
});

// 🚀 START SERVER (local dev only — Vercel uses api/index.js instead)
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Server running on port " + PORT);
  });
}

module.exports = app;