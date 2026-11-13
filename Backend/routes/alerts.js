// 🚨 Alert routes — SOS dispatch, live tracking, and the debug test alert.
//
// Guard matrix (explicit, in one place): every mutating route here is
// API-key gated + rate-limited, with two deliberate exceptions:
// POST /alert/:id/ack also accepts the per-alert view token (contacts
// have no API key — D10), and POST /escalate / /delivery-retry are
// QStash callbacks authenticated by HMAC job tokens (D4/D10), since
// QStash cannot carry our x-api-key header. requireApiKey audits
// rejected keys, so a brute-force walk leaves a trail.
const express = require("express");
const requireApiKey = require("../middleware/requireApiKey");
const { sosLimiter, trackingLimiter, testLimiter } = require("../middleware/rateLimit");
const {
  isValidLatitude,
  isValidLongitude,
  isFiniteNumber,
  toNumber,
  sanitizeText,
} = require("../lib/validate");
const { buildSosMessage } = require("../services/sos");
const { buildBatteryMessage, isBatteryLevelInBand } = require("../services/battery");
const {
  deliverAlert,
  receiptsSummary,
  applyRetryReceipts,
  verifyRetryToken,
  scheduleRetry,
  publicBaseUrl,
  MAX_RETRIES,
} = require("../services/delivery");
const { sendTelegramMessage } = require("../services/telegram");
const { sendVoiceAlert } = require("../services/voice");
const {
  ACK_THRESHOLD,
  ESCALATION_STEPS,
  verifyEscalationToken,
  shouldEscalate,
  failedChannels,
  unackedContacts,
  scheduleEscalation,
} = require("../services/escalation");
const { audit } = require("../services/audit");
const { createAlert, transition, setAlertLocation, recordAck, countingAcks, ackKeyFor } = require("../services/alertLifecycle");
const { viewToken, verifyViewToken } = require("../services/alertView");
const alertStore = require("../services/alertStore");
const guardianStore = require("../services/guardianStore");
const { haversineKm } = require("../services/guardianMatch");
const {
  guardianAlertSummary,
  acceptResponse,
  declineResponse,
  recordGuardianAlertLocation,
  addMessage,
  notifyGuardiansForAlert,
} = require("../services/guardianAlert");

const router = express.Router();

// 🛡️ Guardian notify (D21 — plan §6 D21, plan §3 F2). Runs on both
// SOS outcomes (delivered + failed): guardians are an independent
// rescue path, and a failed contact delivery must not silently skip
// them. Must never turn a delivered SOS into a 500: a throwing
// matcher is recorded as a notify-error, not a dispatch failure.
// Idempotent per alert (services/guardianAlert.js) — a retry-
// delivered alert does not re-notify.
const safeNotifyGuardians = async (alert, lat, lng) => {
  try {
    return await notifyGuardiansForAlert({ alert, lat, lng });
  } catch {
    return { notified: 0, failed: 0, reason: "notify-error" };
  }
};

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
  // can see who else the user chose to alert. D9: a contact may also
  // carry a pushToken (the app will send it once token collection
  // lands); it is sanitized like any field and never logged.
  const contacts = (Array.isArray(req.body.contacts) ? req.body.contacts : [])
    .slice(0, 10)
    .map((c) => ({
      name: sanitizeText(c?.name, 60),
      phone: sanitizeText(c?.phone, 20),
      pushToken: sanitizeText(c?.pushToken, 1024),
    }))
    .filter((c) => c.name || c.phone || c.pushToken);

  // Declared outside try so the catch path can mark the alert failed
  // instead of leaving it stuck in "dispatching" when dispatch throws.
  let alert = null;
  try {
    // D3 lifecycle: every SOS is an alert record now, not just a Telegram
    // send. created → dispatching → delivered/failed, with the audit
    // trail carrying the alert id (no PII in audit lines, as before).
    // D9: the record is created BEFORE the message is built, carrying
    // the trigger position, so the message can embed the contacts-side
    // alert-view link for this exact alert.
    alert = createAlert({ contactsCount: contacts.length, lat: latNum, lng: lngNum });
    // H3: bind ACKs to the contacts this SOS actually went to — only
    // their identifiers count toward the 2-ack stop. One-way hashes
    // of the sanitized phones/tokens (the same values the message
    // carries); the raw identifiers are never stored on the alert.
    alert.contactKeys = contacts.map((c) => ackKeyFor({ phone: c.phone, pushToken: c.pushToken }));
    audit("alert.created", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { alertId: alert.id, contacts: contacts.length },
    });
    transition(alert, "dispatching", "telegram fan-out started");
    alertStore.save(alert);

    // D9 alert-view link: only when both halves exist — a public base
    // URL to point at, and a signing secret to mint the per-alert
    // token with. Without either, no link is emitted (a link that
    // 401s for every contact would be worse than none: it would look
    // like the system is broken rather than unconfigured).
    const viewBase = publicBaseUrl();
    const token = viewToken(alert.id);
    const viewUrl =
      viewBase && token ? `${viewBase}/alert/${alert.id}/view?token=${token}` : null;

    const message = buildSosMessage({
      name,
      phone,
      battery,
      status,
      nearestStation,
      lat: latNum,
      lng: lngNum,
      contacts,
      viewUrl: viewUrl || "",
    });
    // L5: the exact message + contacts this SOS went out with, so a
    // later /delivery-retry or /escalate callback re-sends the stored
    // original instead of trusting body-supplied text. Saved with the
    // alert below (both the delivered and the failed branches save).
    alert.sosMessage = message;
    alert.sosContacts = contacts;

    // AWAIT delivery before answering. On Vercel serverless the function
    // can freeze as soon as the response is sent, so the old
    // fire-and-forget call often died before Telegram received anything —
    // while the app still showed "Alert Sent". D4: fan-out runs through
    // the delivery engine (all channels in parallel, per-channel
    // receipts); success means at least one channel actually accepted
    // the message. On TOTAL failure a QStash retry is scheduled (D4
    // policy: partial delivery is delivered — retrying its failed
    // channels is D10's escalation ladder, not this route's job).
    const receipts = await deliverAlert({ message, contacts });
    const { sent, failed } = receiptsSummary(receipts);
    alert.delivery = receipts;
    alert.sent = sent;
    alert.failed = failed;
    console.log(`📨 SOS for ${name} at ${latNum},${lngNum}: delivery sent=${sent} failed=${failed}`);
    if (sent === 0) {
      transition(alert, "failed", "all channels failed");
      // D21: guardians are notified even when every contact channel
      // failed — they may be the only rescue path left.
      const guardianNotify = await safeNotifyGuardians(alert, latNum, lngNum);
      alert.retry = await scheduleRetry({ alertId: alert.id, attempt: 1, message, contacts });
      alertStore.save(alert);
      audit("alert.failed", {
        actorKey: req.header("x-api-key"),
        ip: req.ip,
        meta: { alertId: alert.id, sent, failed, contacts: contacts.length, retryQueued: alert.retry.queued, guardiansNotified: guardianNotify.notified },
      });
      return res
        .status(502)
        .json({ success: false, error: "Alert could not be delivered. Please try again.", alertId: alert.id, state: alert.state, delivery: receipts, retry: alert.retry, viewUrl, guardians: guardianNotify });
    }
    transition(alert, "delivered", "channel accepted");
    // D10: the escalation ladder is scheduled now, for this alert, and
    // each QStash callback re-checks the ACK stop condition before
    // sending anything. A failed schedule is recorded on the alert
    // (queued:false + reason) — never silently dropped, and never a
    // reason to fail an SOS that already delivered.
    alert.escalation = {
      scheduled: (await scheduleEscalation({ alertId: alert.id, message, contacts })).steps,
      runs: [],
    };
    // D21: nearby guardians are notified now that the SOS is out.
    const guardianNotify = await safeNotifyGuardians(alert, latNum, lngNum);
    alertStore.save(alert);
    // Audit: counts + contact count only — no PII (names, phones,
    // coordinates, message text) ever lands in an audit line.
    audit("alert.delivered", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { alertId: alert.id, sent, failed, contacts: contacts.length, guardiansNotified: guardianNotify.notified },
    });
    res.json({ success: true, message: "Alert delivered successfully", alertId: alert.id, state: alert.state, delivery: receipts, viewUrl, escalation: alert.escalation, guardians: guardianNotify });
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

// 🔋 BATTERY ALERT (D11 — plan §6 D11, plan §2 S1).
//
// A dying phone warns contacts BEFORE it dies: `low` at 15%
// (last location, explicitly not an SOS) and `final` at 5% while
// an alert is active (final location burst). Same guards as SOS
// (API key + SOS rate-limit bucket: each hit fans out to contacts),
// same fan-out and receipt honesty — but deliberately NOT an SOS:
// no alert record is created, no D10 escalation is scheduled, and
// no D4 retry is queued. A battery warning must never trigger
// voice calls, and a failed one is the app's to re-try, not the
// server's (the server owns nothing for it). The kind must match
// the reported level's band (services/battery.js), so a buggy or
// spoofed client cannot cry "phone may die" at 90%.
// A `final` burst naming a live (delivered/acked) alert also moves
// that alert's stored position and embeds its view link, so the
// contacts-side page shows the final pin. A final naming an unknown,
// closed or failed alert is 400 (M5) — it is not a standalone send;
// a `low` warning names no alert at all.
router.post("/battery-alert", sosLimiter, requireApiKey, async (req, res) => {
  const { lat, lng } = req.body;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ success: false, error: "Invalid location data" });
  }
  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);

  const kind = req.body.kind;
  if (kind !== "low" && kind !== "final") {
    return res.status(400).json({ success: false, error: "Invalid battery alert kind" });
  }
  if (!isFiniteNumber(req.body.battery)) {
    return res.status(400).json({ success: false, error: "Invalid battery level" });
  }
  const batteryNum = toNumber(req.body.battery);
  if (batteryNum < 0 || batteryNum > 100 || !isBatteryLevelInBand(kind, batteryNum)) {
    return res.status(400).json({ success: false, error: "Battery level does not match alert kind" });
  }

  const name = sanitizeText(req.body.name, 100) || "Unknown User";
  const phone = sanitizeText(req.body.phone, 30) || "Not Provided";
  const contacts = (Array.isArray(req.body.contacts) ? req.body.contacts : [])
    .slice(0, 10)
    .map((c) => ({
      name: sanitizeText(c?.name, 60),
      phone: sanitizeText(c?.phone, 20),
      pushToken: sanitizeText(c?.pushToken, 1024),
    }))
    .filter((c) => c.name || c.phone || c.pushToken);
  const alertId = sanitizeText(req.body.alertId, 64);

  // M5: kind must match the alert context. A "final" burst is the last
  // gasp of an alert that already went out, so it needs a live
  // (delivered/acked) alertId — a spoofed final must not move a dead
  // alert's pin or embed its view link. A "low" warning is standalone
  // and must not name an alert at all.
  let liveAlert = null;
  if (kind === "final") {
    if (!alertId) {
      return res.status(400).json({ success: false, error: "A final battery alert needs a live alertId" });
    }
    liveAlert = await alertStore.get(alertId);
    if (!liveAlert || (liveAlert.state !== "delivered" && liveAlert.state !== "acked")) {
      return res.status(400).json({ success: false, error: "final battery alert needs a live (delivered/acked) alert" });
    }
  } else if (alertId) {
    return res.status(400).json({ success: false, error: "A low battery alert must not name an alert" });
  }

  try {
    let viewUrl = null;
    if (liveAlert) {
      try {
        setAlertLocation(liveAlert, latNum, lngNum);
        alertStore.save(liveAlert);
        const viewBase = publicBaseUrl();
        const token = viewToken(liveAlert.id);
        if (viewBase && token) {
          viewUrl = `${viewBase}/alert/${liveAlert.id}/view?token=${token}`;
        }
      } catch {
        // The fan-out below still runs.
      }
    }

    const message = buildBatteryMessage({
      kind,
      name,
      phone,
      battery: batteryNum,
      lat: latNum,
      lng: lngNum,
      contacts,
      viewUrl: viewUrl || "",
    });
    const receipts = await deliverAlert({ message, contacts });
    const { sent, failed } = receiptsSummary(receipts);
    audit("battery.alert", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { kind, alertId: alertId || null, sent, failed, contacts: contacts.length },
    });
    if (sent === 0) {
      return res
        .status(502)
        .json({ success: false, error: "Battery alert could not be delivered.", delivery: receipts, viewUrl });
    }
    res.json({ success: true, message: "Battery alert delivered", kind, alertId: alertId || null, delivery: receipts, viewUrl });
  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to send battery alert" });
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

// ✅ CONTACT ACKNOWLEDGEMENT (D10 — plan §6 D10 "ACK tracking").
//
// A contact saying "I got this" is what stops the escalation ladder
// (2 distinct acks — plan §6 F1). Auth is EITHER the per-alert view
// token (a contact with only the SOS link, no app, no API key) OR
// the API key (the victim's app / a future guardian client). The
// contact's identifier (phone, or pushToken) is optional: with it,
// the ack dedupes per contact and the voice step can skip them; the
// stored record keeps only the one-way hash (services/
// alertLifecycle.js), never the raw number. An identifier that is
// not one of the contacts this SOS went to is rejected (400) —
// anyone with the link could otherwise fabricate confirmations and
// stop the escalation while nobody came. An ack with no identifier
// is recorded once (anonymous slot) but never counts toward the
// stop. A closed alert is 410 (its emergency is over — an ack then
// would restart nothing, and the view page is 410 too); any other
// non-live state is 409.
const ackAuth = (req, res, next) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (verifyViewToken(req.params.id, token)) return next();
  return requireApiKey(req, res, next);
};

router.post("/alert/:id/ack", trackingLimiter, ackAuth, async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) {
    return res.status(404).json({ success: false, error: "Alert not found" });
  }
  if (alert.state === "closed") {
    audit("alert.ack_denied", { ip: req.ip, meta: { alertId: alert.id } });
    return res.status(410).json({ success: false, error: "This alert is closed" });
  }
  if (alert.state !== "delivered" && alert.state !== "acked") {
    return res.status(409).json({ success: false, error: "Alert is not awaiting confirmation" });
  }
  const body = req.body || {};
  const { isNew, counts, rejected } = recordAck(alert, {
    phone: sanitizeText(body.contact || body.phone, 20),
    pushToken: sanitizeText(body.pushToken, 1024),
  });
  if (rejected) {
    return res.status(400).json({ success: false, error: "Unknown contact — only the contacts this SOS went to can acknowledge it" });
  }
  if (isNew && counts && alert.state === "delivered") {
    transition(alert, "acked", "contact acknowledged");
  }
  alertStore.save(alert);
  const ackCount = countingAcks(alert).length;
  audit("alert.ack", { ip: req.ip, meta: { alertId: alert.id, ackCount, isNew } });
  // The no-JavaScript view page posts this form: answer with a
  // redirect back to the page (token preserved) instead of JSON the
  // contact's browser would dump as raw text. The redirect is only
  // offered when the token that authorized this ack is a valid view
  // token — an API-key ack without one has no page to return to.
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (req.is("application/x-www-form-urlencoded") && verifyViewToken(alert.id, token)) {
    return res.redirect(303, `/alert/${alert.id}/view?token=${encodeURIComponent(token)}`);
  }
  res.json({ success: true, alertId: alert.id, state: alert.state, ackCount, acked: isNew && counts });
});

// POST /alert/:id/close — end an alert from the responder side (API key
// only). Only a delivered/acked alert can close; anything earlier is 409.
// Closing is what makes the 24 h view-token expiry real before its time:
// the view, location and ack routes all answer 410 for closed alerts, and
// the escalation callbacks ignore closed alerts. There is no re-open.
router.post("/alert/:id/close", trackingLimiter, requireApiKey, async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });
  if (alert.state !== "delivered" && alert.state !== "acked") {
    return res
      .status(409)
      .json({ success: false, error: `Alert is ${alert.state}; only delivered/acked alerts can close` });
  }
  transition(alert, "closed");
  alertStore.save(alert);
  audit("alert.closed", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id } });
  return res.json({ success: true, alertId: alert.id, state: "closed" });
});

// 🛡️ GUARDIAN RESPONSES (D21 — plan §6 D21, plan §3 F2).
//
// Shared loader + liveness guard for the alert-scoped guardian
// routes. Liveness: closed → 410 (the emergency is over);
// created/dispatching → 409 (the notify has not run yet);
// delivered/acked/failed → proceed — a failed alert's contacts
// never got the SOS, so its guardians may be the only rescue path.
// A guardian who was never notified for this alert is a 404, same
// as an unknown guardian: the response record is the authorization
// to act on this alert.
const loadAlertGuardian = async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) {
    res.status(404).json({ success: false, error: "Alert not found" });
    return null;
  }
  const guardian = await guardianStore.get(req.params.guardianId);
  if (!guardian) {
    res.status(404).json({ success: false, error: "Guardian not found" });
    return null;
  }
  if (alert.state === "closed") {
    res.status(410).json({ success: false, error: "This alert is closed" });
    return null;
  }
  if (alert.state !== "delivered" && alert.state !== "acked" && alert.state !== "failed") {
    res.status(409).json({ success: false, error: `Alert is ${alert.state}; guardians cannot respond yet` });
    return null;
  }
  const response =
    alert.guardians && alert.guardians.responses && alert.guardians.responses[guardian.id];
  if (!response) {
    res.status(404).json({ success: false, error: "This guardian was not notified for this alert" });
    return null;
  }
  return { alert, guardian, response };
};

// ✅ GUARDIAN ACCEPT — "I'm coming". Repeat accept is an idempotent
// 200 (a client retry must not error); accept after decline, or
// past the 15-min response window, is a 409.
router.post("/alert/:id/guardian/:guardianId/accept", trackingLimiter, requireApiKey, async (req, res) => {
  const loaded = await loadAlertGuardian(req, res);
  if (!loaded) return;
  const { alert, guardian } = loaded;
  let already;
  try {
    ({ already } = acceptResponse(alert.guardians, guardian.id));
  } catch (err) {
    audit("guardian.response_denied", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, guardianId: guardian.id } });
    return res.status(409).json({ success: false, error: err.message });
  }
  alertStore.save(alert);
  audit("guardian.accepted", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, guardianId: guardian.id, already } });
  res.json({ success: true, alertId: alert.id, guardianId: guardian.id, state: "accepted", already });
});

// ❌ GUARDIAN DECLINE — "I can't come". Same idempotency/terminal
// rules as accept, mirrored.
router.post("/alert/:id/guardian/:guardianId/decline", trackingLimiter, requireApiKey, async (req, res) => {
  const loaded = await loadAlertGuardian(req, res);
  if (!loaded) return;
  const { alert, guardian } = loaded;
  let already;
  try {
    ({ already } = declineResponse(alert.guardians, guardian.id));
  } catch (err) {
    audit("guardian.response_denied", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, guardianId: guardian.id } });
    return res.status(409).json({ success: false, error: err.message });
  }
  alertStore.save(alert);
  audit("guardian.declined", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, guardianId: guardian.id, already } });
  res.json({ success: true, alertId: alert.id, guardianId: guardian.id, state: "declined", already });
});

// 📍 GUARDIAN LIVE LOCATION — the accepted guardian's pin, so the
// victim can see "help is 400 m away". Accepted-only (a merely-
// notified guardian has not consented to share location yet);
// the pin NEVER comes back to anyone except the victim's API-key
// read (GET /alert/:id) — the contacts page gets distance only.
router.post("/alert/:id/guardian/:guardianId/location", trackingLimiter, requireApiKey, async (req, res) => {
  const loaded = await loadAlertGuardian(req, res);
  if (!loaded) return;
  const { alert, guardian } = loaded;
  const { lat, lng } = req.body;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ success: false, error: "Invalid location data" });
  }
  let pin;
  try {
    pin = recordGuardianAlertLocation(alert.guardians, guardian.id, toNumber(lat), toNumber(lng));
  } catch (err) {
    return res.status(409).json({ success: false, error: err.message });
  }
  alertStore.save(alert);
  audit("guardian.location_update", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, guardianId: guardian.id } });
  const distanceKm =
    Number.isFinite(alert.lat) && Number.isFinite(alert.lng)
      ? Math.round(haversineKm(alert.lat, alert.lng, pin.lat, pin.lng) * 10) / 10
      : null;
  res.json({ success: true, alertId: alert.id, guardianId: guardian.id, locationUpdatedAt: pin.updatedAt, distanceKm });
});

// 💬 PRESET MESSAGE (D21 chat-lite). Body: {sender: "victim" |
// "guardian", guardianId?, key}. Keys are role-bound and the text is
// server-rendered from the key (services/guardianAlert.js) — no free
// text ever reaches a screen. A guardian sender must be a known,
// accepted responder; an unknown key or sender is a 400.
router.post("/alert/:id/message", trackingLimiter, requireApiKey, async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) return res.status(404).json({ success: false, error: "Alert not found" });
  if (alert.state === "closed") return res.status(410).json({ success: false, error: "This alert is closed" });
  if (alert.state !== "delivered" && alert.state !== "acked" && alert.state !== "failed") {
    return res.status(409).json({ success: false, error: `Alert is ${alert.state}; messages cannot be sent yet` });
  }
  const sender = req.body.sender;
  const key = req.body.key;
  const guardianId = typeof req.body.guardianId === "string" ? req.body.guardianId : "";
  if (sender !== "victim" && sender !== "guardian") {
    return res.status(400).json({ success: false, error: "Invalid message sender" });
  }
  if (typeof key !== "string" || !key) {
    return res.status(400).json({ success: false, error: "Invalid message" });
  }
  if (sender === "guardian") {
    const guardian = await guardianStore.get(guardianId);
    if (!guardian) return res.status(404).json({ success: false, error: "Guardian not found" });
  }
  if (!alert.guardians) {
    return res.status(404).json({ success: false, error: "No guardians were notified for this alert" });
  }
  let message;
  try {
    message = addMessage(alert.guardians, { sender, guardianId, key });
  } catch (err) {
    const status = /Unknown message/.test(err.message) ? 400 : 409;
    return res.status(status).json({ success: false, error: err.message });
  }
  alertStore.save(alert);
  audit("guardian.message", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { alertId: alert.id, key } });
  res.json({ success: true, alertId: alert.id, message });
});

// 🪜 ESCALATION CALLBACK (QStash — D10)
//
// Auth is the HMAC token over (alertId, step) keyed by API_SECRET
// (services/escalation.js), the same pattern as /delivery-retry:
// QStash cannot carry our x-api-key header. The message + contacts
// re-sent here are the STORED originals from SOS time (L5 twin),
// not the callback body's copy — the body is only a legacy fallback
// for alerts created before the stored fields existed. Idempotent
// per step: a QStash redelivery of a step that already ran — or is
// still running (M6 reservation) — returns ignored:true instead of
// re-firing — re-sending an SOS because a queue redelivered would be
// a false alarm. The ladder stops early when 2 distinct contacts
// have ACKed, when the alert closed, or when it is not in a live
// state (a failed alert belongs to the D4 retry chain, not this
// ladder).
router.post("/escalate", trackingLimiter, async (req, res) => {
  const alertId = typeof req.body.alertId === "string" ? req.body.alertId : "";
  const step = req.body.step;
  const jobPhones = req.body.contacts;
  const contacts = Array.isArray(jobPhones)
    ? jobPhones.slice(0, 10).map((p) => (typeof p === "string" ? p.slice(0, 20) : ""))
    : [];
  const jobTokens = req.body.pushTokens;
  const pushTokens = Array.isArray(jobTokens)
    ? jobTokens.slice(0, 10).map((t) => (typeof t === "string" ? t.slice(0, 1024) : ""))
    : [];
  if (!alertId || !Number.isInteger(step) || !ESCALATION_STEPS.some((s) => s.step === step) ||
      (jobPhones !== undefined && !Array.isArray(jobPhones)) ||
      (jobTokens !== undefined && !Array.isArray(jobTokens))) {
    return res.status(400).json({ success: false, error: "Invalid escalation job" });
  }
  const jobContacts = contacts
    .map((phone, i) => ({ phone, pushToken: pushTokens[i] || "" }))
    .filter((c) => c.phone || c.pushToken);
  if (!verifyEscalationToken(alertId, step, req.body.token)) {
    audit("escalation.denied", { ip: req.ip, meta: { alertId, step } });
    return res.status(401).json({ success: false, error: "Invalid escalation token" });
  }
  const alert = await alertStore.get(alertId);
  if (!alert) {
    return res.status(404).json({ success: false, error: "Alert not found" });
  }
  // L5 twin: re-send the STORED original message/contacts, not the
  // body-supplied ones (same flaw class as /delivery-retry). Legacy
  // alerts fall back to the callback body's copy.
  const storedMessage = typeof alert.sosMessage === "string" ? alert.sosMessage : "";
  const storedContacts =
    Array.isArray(alert.sosContacts) && alert.sosContacts.length > 0 ? alert.sosContacts : null;
  const message = storedMessage || (typeof req.body.message === "string" ? req.body.message : "");
  const escContacts = storedContacts || jobContacts;
  if (!message || message.length > 4000) {
    return res.status(400).json({ success: false, error: "Invalid escalation job" });
  }
  const ackCount = countingAcks(alert).length;
  // M6: reserve the step SYNCHRONOUSLY, before any await — a QStash
  // redelivery arriving while this callback is still fanning out must
  // see the step as in-progress and stand down, not fire a second
  // SOS. The reservation is replaced by the real run below, or
  // removed if the fan-out throws.
  if (!alert.escalation || typeof alert.escalation !== "object") alert.escalation = {};
  if (!Array.isArray(alert.escalation.runs)) alert.escalation.runs = [];
  const runs = alert.escalation.runs;
  if (runs.some((r) => r.step === step) || !shouldEscalate(alert)) {
    return res.json({ success: true, ignored: true, state: alert.state, ackCount });
  }
  const now = new Date().toISOString();
  const action = step === 3 ? "voice-call" : "refire-failed-channels";
  const reservation = { step, at: now, action, state: "in-progress" };
  runs.push(reservation);
  alertStore.save(alert);
  let run;
  try {
    if (step === 3) {
      // Voice step: call only contacts who have not ACKed, with the
      // original SOS message for the agent to speak. No channel
      // re-fire here — the channels have had two attempts each.
      const targets = unackedContacts(alert, escContacts);
      const voice = await sendVoiceAlert({ message, contacts: targets });
      run = { step, at: now, action, sent: voice.sent, failed: voice.failed, voice };
    } else {
      const channels = failedChannels(alert.delivery);
      const fresh = channels.length
        ? await deliverAlert({ message, contacts: escContacts, channels })
        : [];
      const merged = applyRetryReceipts(alert.delivery, fresh);
      alert.delivery = merged;
      const totals = receiptsSummary(merged);
      alert.sent = totals.sent;
      alert.failed = totals.failed;
      const freshTotals = receiptsSummary(fresh);
      run = { step, at: now, action, channels, sent: freshTotals.sent, failed: freshTotals.failed };
    }
  } catch (err) {
    const idx = runs.indexOf(reservation);
    if (idx >= 0) runs.splice(idx, 1);
    alertStore.save(alert);
    console.log("❌ ERROR:", err.message);
    return res.status(500).json({ success: false, error: "Escalation step failed" });
  }
  const idx = runs.indexOf(reservation);
  if (idx >= 0) runs[idx] = run;
  else runs.push(run);
  alert.escalation = {
    scheduled: alert.escalation?.scheduled ?? alert.escalation?.steps ?? null,
    runs,
  };
  alertStore.save(alert);
  audit("escalation.run", {
    ip: req.ip,
    meta: { alertId: alert.id, step, sent: run.sent, failed: run.failed, state: alert.state, ackCount },
  });
  res.json({
    success: true,
    alertId: alert.id,
    state: alert.state,
    ackCount,
    delivery: alert.delivery,
    escalation: alert.escalation,
  });
});

// 📍 CONTACTS-SIDE ALERT PAGE (D9 — plan §6 D9, "contact ko app na
// ho to browser me live location").
//
// Auth is the per-alert view token (services/alertView.js), NOT the
// API key: contacts have no app and no key. The token is minted at
// SOS time and travels inside the SOS message to the victim's chosen
// contacts only. A missing/wrong token is 401, an unknown id 404, a
// closed alert 410 (its location is stale history, not a live
// emergency — serving it would mislead a contact into rushing to
// an old pin). Rate-limited on the tracking bucket: the token is
// 256-bit HMAC over a UUID, so guessing is infeasible, but an open
// browser endpoint still gets a bucket.
//
// The page reflects ONLY numbers (coordinates), an enum state and an
// ISO timestamp — no name, phone or message text — so there is
// nothing user-controlled left to escape. It carries
// Referrer-Policy: no-referrer plus rel="noreferrer" on every
// outbound link: the token lives in this page's URL query, and a
// normal link click would otherwise leak it to Google/OSM in the
// Referer header. Auto-refresh is a meta refresh (no JavaScript):
// the refreshed URL is this same URL, token included.
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const loadViewableAlert = async (req, res) => {
  const alertId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!verifyViewToken(alertId, token)) {
    audit("alert.view_denied", { ip: req.ip, meta: { alertId } });
    res.status(401).json({ success: false, error: "Invalid or missing view token" });
    return null;
  }
  const alert = await alertStore.get(alertId);
  if (!alert) {
    res.status(404).json({ success: false, error: "Alert not found" });
    return null;
  }
  if (alert.state === "closed") {
    res.status(410).json({ success: false, error: "This alert is closed" });
    return null;
  }
  audit("alert.view", { ip: req.ip, meta: { alertId } });
  return alert;
};

const renderAlertPage = (alert, token) => {
  const lat = Number(alert.lat);
  const lng = Number(alert.lng);
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng);
  const at = escapeHtml(alert.locationAt || alert.updatedAt || "");
  const state = escapeHtml(alert.state || "");
  const ackCount = (alert.acks || []).length;
  const canAck = alert.state === "delivered" || alert.state === "acked";
  // D21: counts + nearest accepted distance only — a guardian's exact
  // pin never reaches this token-authenticated page (the victim's
  // API-key read is the only place it appears).
  const g = alert.guardians ? guardianAlertSummary(alert.guardians, { lat: alert.lat, lng: alert.lng }) : null;
  const nearestAccepted = g
    ? g.locations.reduce(
        (min, l) => (typeof l.distanceKm === "number" && (min === null || l.distanceKm < min) ? l.distanceKm : min),
        null
      )
    : null;
  const guardianLine =
    g && g.notified > 0
      ? `<p>🛡️ Guardians: <strong>${g.notified} guardian${g.notified === 1 ? "" : "s"} notified</strong>${g.accepted > 0 ? ` — <strong>${g.accepted} on the way</strong>${nearestAccepted !== null ? ` (nearest ${nearestAccepted} km away)` : ""}` : " — none accepted yet"}.</p>`
      : "";
  const ackAction = `/alert/${escapeHtml(alert.id)}/ack?token=${encodeURIComponent(token || "")}`;
  const mapsUrl = hasFix
    ? `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`
    : "";
  // OSM embed is progressive enhancement: if the embed host refuses
  // framing, the Maps link + coordinates above still carry the page.
  const embedUrl = hasFix
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
        `${lng - 0.02},${lat - 0.02},${lng + 0.02},${lat + 0.02}`
      )}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>SafeLife live alert</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.4rem}.pin{font-size:1.1rem}.muted{color:#555}iframe{width:100%;height:320px;border:1px solid #ccc}</style>
</head>
<body>
<h1>🚨 SafeLife live alert</h1>
<p>Status: <strong>${state}</strong></p>
<p>Confirmations received: <strong>${ackCount} of ${ACK_THRESHOLD} needed</strong> — when 2 contacts confirm, automatic escalation calls stop.</p>
${guardianLine}
<p class="muted">Last location update: ${at}</p>
${
  hasFix
    ? `<p class="pin">📍 ${lat}, ${lng}</p>
<p><a href="${mapsUrl}" rel="noreferrer" target="_blank">Open in Google Maps</a></p>
<iframe title="Live location map" src="${embedUrl}"></iframe>`
    : `<p>No location is available for this alert yet.</p>`
}
<p class="muted">This page refreshes every 30 seconds. If this is an emergency, call the person directly — do not rely on this page alone.</p>
${
  canAck
    ? `<form method="POST" action="${ackAction}">
<p><strong>Did you receive this alert?</strong> Confirming tells SafeLife help is on the way, and stops further escalation calls to you.</p>
<p><label>Your phone number (optional — lets SafeLife skip calling you again):<br>
<input type="tel" name="contact" autocomplete="tel" placeholder="+91..."></label></p>
<p><button type="submit">I received this alert</button></p>
<p class="muted">Your number is stored only as a one-way hash, never shown to anyone.</p>
</form>`
    : ``
}
</body>
</html>`;
};

router.get("/alert/:id/view", trackingLimiter, async (req, res) => {
  const alert = await loadViewableAlert(req, res);
  if (!alert) return;
  res.set("Referrer-Policy", "no-referrer");
  res.set(
    "Content-Security-Policy",
    // form-action 'self': the D10 confirm form posts back to this
    // same origin; without it default-src 'none' would block the
    // POST and the form would silently do nothing.
    "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.openstreetmap.org; form-action 'self'; base-uri 'none'"
  );
  res.type("html").send(renderAlertPage(alert, req.query.token));
});

// 📍 LIVE POSITION (JSON twin of the view page, same token auth).
// Lets a future client poll without scraping HTML; the page itself
// uses meta refresh and never calls this.
router.get("/alert/:id/location", trackingLimiter, async (req, res) => {
  const alert = await loadViewableAlert(req, res);
  if (!alert) return;
  res.json({
    success: true,
    alertId: alert.id,
    state: alert.state,
    lat: alert.lat ?? null,
    lng: alert.lng ?? null,
    locationAt: alert.locationAt ?? null,
  });
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
  // D7: retry jobs carry contact phones (strings only, no names) so a
  // retry can re-fire SMS. Strictly typed like the rest of the job:
  // an array of ≤10 short strings, anything else is a 400. D9: push
  // tokens ride in a parallel array, paired BY INDEX with the phones
  // (see scheduleRetry) — a token without a phone still re-fires push.
  const jobPhones = req.body.contacts;
  const contacts = Array.isArray(jobPhones)
    ? jobPhones.slice(0, 10).map((p) => (typeof p === "string" ? p.slice(0, 20) : ""))
    : [];
  const jobTokens = req.body.pushTokens;
  const pushTokens = Array.isArray(jobTokens)
    ? jobTokens.slice(0, 10).map((t) => (typeof t === "string" ? t.slice(0, 1024) : ""))
    : [];
  if (!alertId || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES ||
      (jobPhones !== undefined && !Array.isArray(jobPhones)) ||
      (jobTokens !== undefined && !Array.isArray(jobTokens))) {
    return res.status(400).json({ success: false, error: "Invalid retry job" });
  }
  const retryContacts = contacts
    .map((phone, i) => ({ phone, pushToken: pushTokens[i] || "" }))
    .filter((c) => c.phone || c.pushToken);
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
  // L5: re-send the STORED original message/contacts, not the
  // body-supplied ones — a leaked token must not let anyone rewrite
  // an SOS into arbitrary text to arbitrary numbers. Legacy alerts
  // (created before the stored fields) fall back to the callback
  // body's copy, which scheduleRetry wrote at SOS time; that fallback
  // dies with those alerts.
  const storedMessage = typeof alert.sosMessage === "string" ? alert.sosMessage : "";
  const storedContacts =
    Array.isArray(alert.sosContacts) && alert.sosContacts.length > 0 ? alert.sosContacts : null;
  const resendMessage = storedMessage || message;
  const resendContacts = storedContacts || retryContacts;
  if (!resendMessage || resendMessage.length > 4000) {
    return res.status(400).json({ success: false, error: "Invalid retry job" });
  }
  // L5 single-use: each attempt fires at most once. The check runs
  // before the transition so a replay never moves the alert, and the
  // mark lands before the fan-out so a concurrent replay sees it.
  alert.retryConsumed = Array.isArray(alert.retryConsumed) ? alert.retryConsumed : [];
  if (alert.retryConsumed.includes(attempt)) {
    return res.status(409).json({ success: false, error: "Retry attempt already used" });
  }
  try {
    transition(alert, "dispatching", `delivery retry attempt ${attempt}`);
  } catch {
    return res.json({ success: true, ignored: true, state: alert.state });
  }
  alert.retryConsumed.push(attempt);
  alertStore.save(alert);
  // The retry re-sends the ORIGINAL SOS message (stored at SOS time,
  // see above): the callback instance shares no memory with the
  // instance that took the SOS, and a location-less retry notice
  // would be a neutered alert. The message is only ever sent to our
  // own configured channels, never reflected or logged.
  const receipts = await deliverAlert({ message: resendMessage, contacts: resendContacts });
  const { sent, failed } = receiptsSummary(receipts);
  alert.delivery = applyRetryReceipts(alert.delivery, receipts);
  alert.sent = sent;
  alert.failed = failed;
  if (sent > 0) {
    transition(alert, "delivered", `retry attempt ${attempt} accepted`);
    alert.retry = { queued: false, reason: "delivered" };
    // D10: a retry-delivered alert gets the same ladder as a
    // first-try delivery — its contacts still need the ACK check.
    alert.escalation = {
      scheduled: (await scheduleEscalation({ alertId: alert.id, message: resendMessage, contacts: resendContacts })).steps,
      runs: [],
    };
  } else {
    transition(alert, "failed", `retry attempt ${attempt} failed`);
    alert.retry = await scheduleRetry({ alertId: alert.id, attempt: attempt + 1, message: resendMessage, contacts: resendContacts });
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

  // D9: when the app names the alert this update belongs to, record
  // the live position on it so the contacts-side page moves. Best
  // effort and never fatal: an unknown/stale alertId, a closed alert,
  // or a store error must not break the Telegram leg below (the
  // update's original job). No state transition — location is
  // orthogonal to the lifecycle (services/alertLifecycle.js).
  const alertId = sanitizeText(req.body.alertId, 64);
  if (alertId) {
    try {
      const alert = await alertStore.get(alertId);
      if (alert && alert.state !== "closed") {
        setAlertLocation(alert, latNum, lngNum);
        alertStore.save(alert);
      }
    } catch {
      // Telegram leg below still runs.
    }
  }

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
