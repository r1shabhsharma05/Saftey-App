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
const { createAlert, transition, setAlertLocation, recordAck } = require("../services/alertLifecycle");
const { viewToken, verifyViewToken } = require("../services/alertView");
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
      alert.retry = await scheduleRetry({ alertId: alert.id, attempt: 1, message, contacts });
      alertStore.save(alert);
      audit("alert.failed", {
        actorKey: req.header("x-api-key"),
        ip: req.ip,
        meta: { alertId: alert.id, sent, failed, contacts: contacts.length, retryQueued: alert.retry.queued },
      });
      return res
        .status(502)
        .json({ success: false, error: "Alert could not be delivered. Please try again.", alertId: alert.id, state: alert.state, delivery: receipts, retry: alert.retry, viewUrl });
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
    alertStore.save(alert);
    // Audit: counts + contact count only — no PII (names, phones,
    // coordinates, message text) ever lands in an audit line.
    audit("alert.delivered", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { alertId: alert.id, sent, failed, contacts: contacts.length },
    });
    res.json({ success: true, message: "Alert delivered successfully", alertId: alert.id, state: alert.state, delivery: receipts, viewUrl, escalation: alert.escalation });
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

// ✅ CONTACT ACKNOWLEDGEMENT (D10 — plan §6 D10 "ACK tracking").
//
// A contact saying "I got this" is what stops the escalation ladder
// (2 distinct acks — plan §6 F1). Auth is EITHER the per-alert view
// token (a contact with only the SOS link, no app, no API key) OR
// the API key (the victim's app / a future guardian client). The
// contact's identifier (phone, or pushToken) is optional: with it,
// the ack dedupes per contact and the voice step can skip them; the
// stored record keeps only the one-way hash (services/
// alertLifecycle.js), never the raw number. Without it the ack
// counts once, anonymously. A closed alert is 410 (its emergency is
// over — an ack then would restart nothing, and the view page is
// 410 too); any other non-live state is 409.
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
  const { isNew } = recordAck(alert, {
    phone: sanitizeText(body.contact || body.phone, 20),
    pushToken: sanitizeText(body.pushToken, 1024),
  });
  if (isNew && alert.state === "delivered") {
    transition(alert, "acked", "contact acknowledged");
  }
  alertStore.save(alert);
  const ackCount = (alert.acks || []).length;
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
  res.json({ success: true, alertId: alert.id, state: alert.state, ackCount, acked: isNew });
});

// 🪜 ESCALATION CALLBACK (QStash — D10)
//
// Auth is the HMAC token over (alertId, step) keyed by API_SECRET
// (services/escalation.js), the same pattern as /delivery-retry:
// QStash cannot carry our x-api-key header. The body carries the
// original SOS message + contact phones/pushTokens (same pairing as
// D7/D9 retries). Idempotent per step: a QStash redelivery of a step
// that already ran returns ignored:true instead of re-firing —
// re-sending an SOS because a queue redelivered would be a false
// alarm. The ladder stops early when 2 distinct contacts have ACKed,
// when the alert closed, or when it is not in a live state (a failed
// alert belongs to the D4 retry chain, not this ladder).
router.post("/escalate", trackingLimiter, async (req, res) => {
  const alertId = typeof req.body.alertId === "string" ? req.body.alertId : "";
  const step = req.body.step;
  const message = typeof req.body.message === "string" ? req.body.message : "";
  const jobPhones = req.body.contacts;
  const contacts = Array.isArray(jobPhones)
    ? jobPhones.slice(0, 10).map((p) => (typeof p === "string" ? p.slice(0, 20) : ""))
    : [];
  const jobTokens = req.body.pushTokens;
  const pushTokens = Array.isArray(jobTokens)
    ? jobTokens.slice(0, 10).map((t) => (typeof t === "string" ? t.slice(0, 1024) : ""))
    : [];
  if (!alertId || !Number.isInteger(step) || !ESCALATION_STEPS.some((s) => s.step === step) || !message || message.length > 4000 ||
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
  const ackCount = (alert.acks || []).length;
  const runs = alert.escalation?.runs || [];
  if (runs.some((r) => r.step === step) || !shouldEscalate(alert)) {
    return res.json({ success: true, ignored: true, state: alert.state, ackCount });
  }
  const now = new Date().toISOString();
  let run;
  if (step === 3) {
    // Voice step: call only contacts who have not ACKed, with the
    // original SOS message for the agent to speak. No channel
    // re-fire here — the channels have had two attempts each.
    const targets = unackedContacts(alert, jobContacts);
    const voice = await sendVoiceAlert({ message, contacts: targets });
    run = { step, at: now, action: "voice-call", sent: voice.sent, failed: voice.failed, voice };
  } else {
    const channels = failedChannels(alert.delivery);
    const fresh = channels.length
      ? await deliverAlert({ message, contacts: jobContacts, channels })
      : [];
    const merged = applyRetryReceipts(alert.delivery, fresh);
    alert.delivery = merged;
    const totals = receiptsSummary(merged);
    alert.sent = totals.sent;
    alert.failed = totals.failed;
    const freshTotals = receiptsSummary(fresh);
    run = { step, at: now, action: "refire-failed-channels", channels, sent: freshTotals.sent, failed: freshTotals.failed };
  }
  alert.escalation = {
    scheduled: alert.escalation?.scheduled ?? alert.escalation?.steps ?? null,
    runs: [...runs, run],
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
  if (!alertId || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RETRIES || !message || message.length > 4000 ||
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
  const receipts = await deliverAlert({ message, contacts: retryContacts });
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
      scheduled: (await scheduleEscalation({ alertId: alert.id, message, contacts: retryContacts })).steps,
      runs: [],
    };
  } else {
    transition(alert, "failed", `retry attempt ${attempt} failed`);
    alert.retry = await scheduleRetry({ alertId: alert.id, attempt: attempt + 1, message, contacts: retryContacts });
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
