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
const { buildSosMessage } = require("../services/sos");
const {
  deliverAlert,
  receiptsSummary,
  applyRetryReceipts,
  verifyRetryToken,
  scheduleRetry,
  MAX_RETRIES,
} = require("../services/delivery");
const { sendTelegramMessage } = require("../services/telegram");
const { audit } = require("../services/audit");
const { createAlert, transition } = require("../services/alertLifecycle");
const alertStore = require("../services/alertStore");

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

  // Declared outside try so the catch path can mark the alert failed
  // instead of leaving it stuck in "dispatching" when dispatch throws.
  let alert = null;
  try {
    // D3 lifecycle: every SOS is an alert record now, not just a Telegram
    // send. created → dispatching → delivered/failed, with the audit
    // trail carrying the alert id (no PII in audit lines, as before).
    alert = createAlert({ contactsCount: contacts.length });
    audit("alert.created", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { alertId: alert.id, contacts: contacts.length },
    });
    transition(alert, "dispatching", "telegram fan-out started");
    alertStore.save(alert);

    // AWAIT delivery before answering. On Vercel serverless the function
    // can freeze as soon as the response is sent, so the old
    // fire-and-forget call often died before Telegram received anything —
    // while the app still showed "Alert Sent". D4: fan-out runs through
    // the delivery engine (all channels in parallel, per-channel
    // receipts); success means at least one channel actually accepted
    // the message. On TOTAL failure a QStash retry is scheduled (D4
    // policy: partial delivery is delivered — retrying its failed
    // channels is D10's escalation ladder, not this route's job).
    const receipts = await deliverAlert({ message });
    const { sent, failed } = receiptsSummary(receipts);
    alert.delivery = receipts;
    alert.sent = sent;
    alert.failed = failed;
    console.log(`📨 SOS for ${name} at ${latNum},${lngNum}: delivery sent=${sent} failed=${failed}`);
    if (sent === 0) {
      transition(alert, "failed", "all channels failed");
      alert.retry = await scheduleRetry({ alertId: alert.id, attempt: 1, message });
      alertStore.save(alert);
      audit("alert.failed", {
        actorKey: req.header("x-api-key"),
        ip: req.ip,
        meta: { alertId: alert.id, sent, failed, contacts: contacts.length, retryQueued: alert.retry.queued },
      });
      return res
        .status(502)
        .json({ success: false, error: "Alert could not be delivered. Please try again.", alertId: alert.id, state: alert.state, delivery: receipts, retry: alert.retry });
    }
    transition(alert, "delivered", "channel accepted");
    alertStore.save(alert);
    // Audit: counts + contact count only — no PII (names, phones,
    // coordinates, message text) ever lands in an audit line.
    audit("alert.delivered", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { alertId: alert.id, sent, failed, contacts: contacts.length },
    });
    res.json({ success: true, message: "Alert delivered successfully", alertId: alert.id, state: alert.state, delivery: receipts });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    // A thrown dispatch must not leave the alert in "dispatching": mark
    // it failed (legal from dispatching only — hence the guard) so the
    // record and the audit trail agree the SOS did not go out.
    if (alert && alert.state === "dispatching") {
      try {
        transition(alert, "failed", "dispatch threw");
        alertStore.save(alert);
        audit("alert.failed", {
          actorKey: req.header("x-api-key"),
          ip: req.ip,
          meta: { alertId: alert.id },
        });
      } catch {
        // The failure response below matters more than the bookkeeping.
      }
    }
    // Generic message — err.message can leak internals (Telegram API
    // errors, stack fragments). Details stay in the server logs.
    res.status(500).json({ success: false, error: "Failed to send alert" });
  }
});

// 🔍 ALERT STATUS (D3 read path for the lifecycle)
// API-key gated + tracking limiter (a read, not an SOS — it must not eat
// the SOS budget). Returns the alert's current state and delivery
// counters, or 404. This is what D5's in-app delivery-status UI polls,
// and what the D6 phase test asserts against. Serverless caveat: an id
// created on another instance is only visible here once Supabase is
// configured (the shared store); unconfigured, only same-instance
// memory answers — a miss then is "not found here", reported as 404.
router.get("/alert/:id", trackingLimiter, requireApiKey, async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) {
    return res.status(404).json({ success: false, error: "Alert not found" });
  }
  res.json({ success: true, alert: alertStore.toPublic(alert) });
});

// 🔁 DELIVERY RETRY (QStash callback — D4)
// Auth is NOT requireApiKey: QStash cannot carry our x-api-key header,
// so the job body carries an HMAC token over (alertId, attempt) keyed
// by API_SECRET (services/delivery.js). A bad token is a 401 and an
// audit line; a missing/unknown alert is a 404. Rate-limited like a
// tracking read — retries are sparse by construction (max 3 per alert).
// Idempotent: only a "failed" alert retries. A duplicate QStash
// delivery (or a retry arriving after a later success) returns 200
// with ignored:true instead of re-firing the alert — re-sending an SOS
// because a queue redelivered would be a false alarm to every contact.
router.post("/delivery-retry", trackingLimiter, async (req, res) => {
  const alertId = typeof req.body.alertId === "string" ? req.body.alertId : "";
  const attempt = req.body.attempt;
  const message = typeof req.body.message === "string" ? req.body.message : "";
  if (!alertId || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES || !message || message.length > 4000) {
    return res.status(400).json({ success: false, error: "Invalid retry job" });
  }
  if (!verifyRetryToken(alertId, attempt, req.body.token)) {
    audit("delivery.retry_denied", { ip: req.ip, meta: { alertId, attempt } });
    return res.status(401).json({ success: false, error: "Invalid retry token" });
  }
  const alert = await alertStore.get(alertId);
  if (!alert) {
    return res.status(404).json({ success: false, error: "Alert not found" });
  }
  if (alert.state !== "failed") {
    return res.json({ success: true, ignored: true, state: alert.state });
  }
  try {
    transition(alert, "dispatching", `delivery retry attempt ${attempt}`);
  } catch {
    return res.json({ success: true, ignored: true, state: alert.state });
  }
  // The retry re-sends the ORIGINAL SOS message, carried in the job
  // body by scheduleRetry: the callback instance shares no memory with
  // the instance that took the SOS, and a location-less retry notice
  // would be a neutered alert. The body message is only ever sent to
  // our own configured channels, never reflected or logged.
  const receipts = await deliverAlert({ message });
  const { sent, failed } = receiptsSummary(receipts);
  alert.delivery = applyRetryReceipts(alert.delivery, receipts);
  alert.sent = sent;
  alert.failed = failed;
  if (sent > 0) {
    transition(alert, "delivered", `retry attempt ${attempt} accepted`);
    alert.retry = { queued: false, reason: "delivered" };
  } else {
    transition(alert, "failed", `retry attempt ${attempt} failed`);
    alert.retry = await scheduleRetry({ alertId: alert.id, attempt: attempt + 1, message });
  }
  alertStore.save(alert);
  audit("delivery.retry", {
    ip: req.ip,
    meta: { alertId: alert.id, attempt, sent, failed, state: alert.state, retryQueued: alert.retry.queued },
  });
  res.json({ success: true, alertId: alert.id, state: alert.state, delivery: alert.delivery, retry: alert.retry });
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
