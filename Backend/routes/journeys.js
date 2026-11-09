// 🧭 Journey Guardian routes — trip create/share + live tracking
// (SafeLife 2.0 Day 16, plan §6 D16, plan §3 F4) + deviation /
// overstay detection → check-in prompt → auto-escalation (Day 17,
// plan §6 D17).
//
// Guard matrix (explicit, in one place): every mutating route is
// API-key gated + tracking-limited. Creating a journey does NOT fan
// out to contacts — the response carries a share link and the
// traveller sends it (native share sheet) — but it DOES accept the
// traveller's emergency contacts (phones only, capped at 10) and
// schedules the overdue-escalate timer job with them in its body:
// the server stores no contact list for other purposes, and the
// contacts never appear in any read shape (toPublic/toView exclude
// them). The contacts-side view page is token-gated, mirroring D9's
// alert page: contacts have no app and no key, and the token is
// minted at create time and travels inside the share link only.
// POST /journey-escalate is the QStash callback: HMAC-token auth,
// no API key (QStash cannot carry one) — same pattern as D10's
// POST /escalate.
const express = require("express");
const requireApiKey = require("../middleware/requireApiKey");
const { trackingLimiter } = require("../middleware/rateLimit");
const {
  isValidLatitude,
  isValidLongitude,
  toNumber,
  sanitizeText,
} = require("../lib/validate");
const { publicBaseUrl } = require("../services/delivery");
const { normalizePhone } = require("../services/sms");
const {
  createJourney,
  transition,
  toPublic,
  toView,
} = require("../services/journey");
const {
  recordJourneyLocation,
  watchStatus,
  newCheckIn,
  publicWatch,
  publicCheckIn,
  CHECKIN_GRACE_MS,
} = require("../services/journeyWatch");
const {
  JOURNEY_ESCALATION_KINDS,
  verifyJourneyEscalationToken,
  shouldEscalateJourney,
  scheduleJourneyEscalation,
  runJourneyEscalation,
} = require("../services/journeyEscalation");
const journeyStore = require("../services/journeyStore");
const { journeyToken, verifyJourneyToken } = require("../services/journeyView");
const { audit } = require("../services/audit");

const router = express.Router();

// Owner + contacts read shapes carry the D17 watch state and the
// pending check-in prompt alongside D16's fields — the app polls
// the owner shape every 30 s, so this is how it learns a prompt
// was asked. Contacts (phones) never ride along: toPublic/toView
// exclude them by design.
const toJourneyPublic = (journey, nowMs = Date.now()) => ({
  ...toPublic(journey, nowMs),
  watch: publicWatch(journey, nowMs),
  checkIn: publicCheckIn(journey),
});

// Emergency contacts for the escalation job body: phones normalized
// (a garbage number is dropped, never stored), push tokens capped,
// capped at 10, pairing preserved by index (D10's rule).
const normalizeJourneyContacts = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .map((c) => ({
      phone: normalizePhone(c?.phone),
      pushToken: typeof c?.pushToken === "string" ? c.pushToken.slice(0, 1024) : "",
    }))
    .filter((c) => c.phone || c.pushToken);
};

// Records pre-D17 shapes defensively: a DB-restored journey has no
// escalation/checkIn fields (fromRow supplies them now, but a row
// written before the D17 migration must not crash a callback).
const ensureWatchFields = (journey) => {
  if (!journey.escalation || typeof journey.escalation !== "object") {
    journey.escalation = { scheduled: [], runs: [] };
  }
  if (!Array.isArray(journey.escalation.scheduled)) journey.escalation.scheduled = [];
  if (!Array.isArray(journey.escalation.runs)) journey.escalation.runs = [];
  if (!Array.isArray(journey.contacts)) journey.contacts = [];
  return journey;
};


// 🧭 CREATE JOURNEY
// API-key gated + tracking limiter (a create is not an SOS — it
// sends nothing to anyone — so it rides the tracking bucket, not
// the SOS one). Coordinates are strictly validated; the destination
// label and name are sanitized before they reach the record. The
// ETA window (future, ≤12 h) is enforced by the service, which
// throws a safe validation message the route returns as a 400.
router.post("/journeys", trackingLimiter, requireApiKey, async (req, res) => {
  const { originLat, originLng, destLat, destLng } = req.body;
  if (
    !isValidLatitude(originLat) ||
    !isValidLongitude(originLng) ||
    !isValidLatitude(destLat) ||
    !isValidLongitude(destLng)
  ) {
    return res.status(400).json({ success: false, error: "Invalid journey coordinates" });
  }
  const destinationLabel = sanitizeText(req.body.destinationLabel, 200);
  if (!destinationLabel) {
    return res.status(400).json({ success: false, error: "Invalid destination label" });
  }
  const expectedArrivalAt =
    typeof req.body.expectedArrivalAt === "string" ? req.body.expectedArrivalAt : "";
  const userName = sanitizeText(req.body.userName, 100) || "Unknown User";
  // D17: the traveller's emergency contacts ride the escalation job
  // body (phones normalized, garbage dropped, capped at 10). They
  // are stored on the record for the timer callback and NEVER leave
  // in a read shape.
  const contacts = normalizeJourneyContacts(req.body.contacts);
  let journey;
  try {
    journey = createJourney({
      originLat: toNumber(originLat),
      originLng: toNumber(originLng),
      destLat: toNumber(destLat),
      destLng: toNumber(destLng),
      destinationLabel,
      expectedArrivalAt,
      userName,
      contacts,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  // M7: a full store of live trips refuses the create (503) instead
  // of evicting a stranger's live journey — the traveller retries.
  if (journeyStore.save(journey) === false) {
    return res.status(503).json({ success: false, error: "Journey store is full of live trips — please try again shortly" });
  }
  audit("journey.created", {
    actorKey: req.header("x-api-key"),
    ip: req.ip,
    meta: { journeyId: journey.id },
  });
  // D17: the overdue timer — one QStash job, firing at ETA + 5 min
  // grace. The job body carries the contacts; the callback re-checks
  // the trip is still active + overdue + unanswered before sending
  // anything. queued:false is surfaced in the response, never hidden
  // (QStash unconfigured in Vercel is the known state until Rishabh
  // sets the vars — detection + the in-app prompt still work).
  const overdueDelaySeconds = Math.max(
    1,
    Math.ceil((Date.parse(journey.expectedArrivalAt) + CHECKIN_GRACE_MS - Date.now()) / 1000)
  );
  const overdueJob = await scheduleJourneyEscalation({
    journey,
    kind: "overdue-escalate",
    delaySeconds: overdueDelaySeconds,
  });
  ensureWatchFields(journey).escalation.scheduled.push(overdueJob);
  journeyStore.save(journey);
  // Share link: only when both halves exist — a public base URL to
  // point at, and a signing secret to mint the per-journey token
  // with. Without either, no link is emitted (same honest rule as
  // D9's alert-view link: a link that 401s for every contact would
  // look like the system is broken rather than unconfigured).
  const viewBase = publicBaseUrl();
  const token = journeyToken(journey.id);
  const viewUrl =
    viewBase && token ? `${viewBase}/journey/${journey.id}/view?token=${token}` : null;
  res.json({ success: true, journey: toJourneyPublic(journey), viewUrl, scheduled: [overdueJob] });
});

// 🔍 JOURNEY STATUS (owner read — what the app polls while a trip
// is active). API-key gated + tracking limiter. Same serverless
// caveat as GET /alert/:id: an id created on another instance is
// only visible here once Supabase is configured; unconfigured, only
// same-instance memory answers.
router.get("/journey/:id", trackingLimiter, requireApiKey, async (req, res) => {
  const journey = await journeyStore.get(req.params.id);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  res.json({ success: true, journey: toJourneyPublic(journey) });
});

// 📍 JOURNEY LOCATION UPDATE
// API-key gated + tracking limiter (same 60/min bucket as alert
// live-tracking — the app posts on the same ≥25 m / ≥30 s cadence).
// A finished journey is 409: its pin is history, and accepting
// positions after arrival would move a trip that is over.
router.post("/journey/:id/location", trackingLimiter, requireApiKey, async (req, res) => {
  const { lat, lng } = req.body;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return res.status(400).json({ success: false, error: "Invalid location data" });
  }
  const journey = await journeyStore.get(req.params.id);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  if (journey.state !== "active") {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  // D17: the pin post is also the watch evaluation point — the
  // app posts on the ≥25 m / ≥30 s cadence, so a deviation or a
  // 10-min stop is seen here within one cadence step of happening.
  recordJourneyLocation(journey, toNumber(lat), toNumber(lng));
  journeyStore.save(journey);
  const watch = watchStatus(journey);
  if (watch.needsCheckIn && !journey.checkIn) {
    // First sight of this reason: ask "Sab theek hai?" and arm the
    // escalation timer. The app sees the prompt on its next 30 s
    // poll; a re-ask needs the traveller's OK to expire first, so
    // this cannot nag every post.
    journey.checkIn = newCheckIn(watch.reason);
    const checkinJob = await scheduleJourneyEscalation({
      journey,
      kind: "checkin-escalate",
      delaySeconds: Math.ceil(CHECKIN_GRACE_MS / 1000),
      askedAt: journey.checkIn.askedAt,
    });
    ensureWatchFields(journey).escalation.scheduled.push(checkinJob);
    journeyStore.save(journey);
    audit("journey.checkin_asked", {
      actorKey: req.header("x-api-key"),
      ip: req.ip,
      meta: { journeyId: journey.id, reason: watch.reason },
    });
  }
  res.json({ success: true, journey: toJourneyPublic(journey) });
});

// ✅ ARRIVED — the traveller got there. Active → arrived only;
// anything else is 409 (a cancelled trip cannot "arrive", and an
// arrived trip is done — D17's overdue check reads the same state,
// so a double-arrive must never re-open the escalation window).
router.post("/journey/:id/arrived", trackingLimiter, requireApiKey, async (req, res) => {
  const journey = await journeyStore.get(req.params.id);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  if (journey.state !== "active") {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  // The state check above and this transition are not atomic across
  // instances (each has its own memory): if the transition throws,
  // answer 409 instead of letting the rejection hang the request —
  // Express 4 does not catch async-handler rejections.
  try {
    transition(journey, "arrived", "traveller arrived");
  } catch {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  journeyStore.save(journey);
  audit("journey.arrived", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { journeyId: journey.id } });
  res.json({ success: true, journey: toJourneyPublic(journey) });
});

// ❌ CANCEL — the traveller called the trip off. Same guards as
// arrived: only an active journey can be cancelled.
router.post("/journey/:id/cancel", trackingLimiter, requireApiKey, async (req, res) => {
  const journey = await journeyStore.get(req.params.id);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  if (journey.state !== "active") {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  // Same non-atomic check-then-transition note as /arrived: a throw
  // must answer 409, never hang the request.
  try {
    transition(journey, "cancelled", "traveller cancelled");
  } catch {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  journeyStore.save(journey);
  audit("journey.cancelled", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { journeyId: journey.id } });
  res.json({ success: true, journey: toJourneyPublic(journey) });
});

// ✅ CHECK-IN ANSWER — the traveller answers the "Sab theek hai?"
// prompt (D17). API-key gated + tracking limiter. ok=true clears
// the prompt and records the answer (suppresses re-prompting for
// that reason for 10 min); ok=false escalates to contacts RIGHT NOW
// on all four channels — the traveller said they need help, so
// there is no grace window left to wait out. A prompt that was
// never asked, or already answered, is 409: answering twice must
// not double-escalate.
router.post("/journey/:id/checkin", trackingLimiter, requireApiKey, async (req, res) => {
  const ok = req.body.ok;
  if (typeof ok !== "boolean") {
    return res.status(400).json({ success: false, error: "Invalid check-in answer" });
  }
  const journey = await journeyStore.get(req.params.id);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  if (journey.state !== "active") {
    return res.status(409).json({ success: false, error: "Journey is not active" });
  }
  if (!journey.checkIn || typeof journey.checkIn.reason !== "string") {
    return res.status(409).json({ success: false, error: "No check-in pending" });
  }
  const reason = journey.checkIn.reason;
  const now = new Date().toISOString();
  journey.checkIn = null;
  if (ok) {
    journey.lastOkAt = now;
    journey.lastOkReason = reason;
    journeyStore.save(journey);
    audit("journey.checkin_ok", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { journeyId: journey.id, reason } });
    return res.json({ success: true, journey: toJourneyPublic(journey) });
  }
  // "I need help": fan out immediately, on the same path the timer
  // callback uses, and record the run so a late timer job for the
  // same prompt stands down instead of re-sending.
  ensureWatchFields(journey);
  const run = await runJourneyEscalation({ journey, reason, contacts: journey.contacts });
  const record = { kind: "checkin-answer", key: `answer:${reason}:${now}`, at: now, reason, sent: run.sent, failed: run.failed };
  journey.escalation.runs.push(record);
  journeyStore.save(journey);
  audit("journey.checkin_help", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { journeyId: journey.id, reason, sent: run.sent, failed: run.failed } });
  res.json({ success: true, journey: toJourneyPublic(journey), escalation: { sent: run.sent, failed: run.failed } });
});

// ⏱️ JOURNEY ESCALATION CALLBACK — QStash fires this at ETA + 5 min
// (overdue-escalate) or askedAt + 5 min (checkin-escalate).
//
// Auth is the HMAC token over (journeyId, kind) keyed by API_SECRET
// (services/journeyEscalation.js), the same pattern as /escalate:
// QStash cannot carry our x-api-key header. The message is built
// from the journey RECORD, never from the job body — a forged
// body cannot rewrite what contacts are told; the body only carries
// the contacts as a cross-instance fallback (the L5-twin lesson).
// Idempotent per job: a QStash redelivery of a run that already ran
// — or is still running (reservation, M6 pattern) — returns
// ignored:true instead of re-firing. The callback stands down when
// the trip arrived, went back on route, or the traveller answered OK.
router.post("/journey-escalate", trackingLimiter, async (req, res) => {
  const journeyId = typeof req.body.journeyId === "string" ? req.body.journeyId : "";
  const kind = req.body.kind;
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const askedAt = typeof req.body.askedAt === "string" ? req.body.askedAt : null;
  const jobPhones = req.body.contacts;
  const contacts = Array.isArray(jobPhones)
    ? jobPhones.slice(0, 10).map((ph) => (typeof ph === "string" ? ph.slice(0, 20) : ""))
    : [];
  const jobTokens = req.body.pushTokens;
  const pushTokens = Array.isArray(jobTokens)
    ? jobTokens.slice(0, 10).map((t) => (typeof t === "string" ? t.slice(0, 1024) : ""))
    : [];
  if (
    !journeyId || !JOURNEY_ESCALATION_KINDS.includes(kind) ||
    (jobPhones !== undefined && !Array.isArray(jobPhones)) ||
    (jobTokens !== undefined && !Array.isArray(jobTokens))
  ) {
    return res.status(400).json({ success: false, error: "Invalid journey escalation job" });
  }
  if (!verifyJourneyEscalationToken(journeyId, kind, token)) {
    audit("journey.escalate_denied", { ip: req.ip, meta: { journeyId, kind } });
    return res.status(401).json({ success: false, error: "Invalid escalation token" });
  }
  const journey = await journeyStore.get(journeyId);
  if (!journey) {
    return res.status(404).json({ success: false, error: "Journey not found" });
  }
  ensureWatchFields(journey);
  const decision = shouldEscalateJourney(journey, kind, askedAt);
  if (!decision.escalate) {
    return res.json({ success: true, ignored: true, reason: decision.reason, state: journey.state });
  }
  // M6 reservation, synchronously before any await: a QStash
  // redelivery arriving while this callback is still fanning out
  // must see the job as in-progress and stand down.
  const key = `${kind}:${askedAt || "eta"}`;
  if (journey.escalation.runs.some((r) => r.key === key)) {
    return res.json({ success: true, ignored: true, reason: "already-ran", state: journey.state });
  }
  const now = new Date().toISOString();
  const reservation = { kind, key, at: now, reason: decision.reason, state: "in-progress" };
  journey.escalation.runs.push(reservation);
  journeyStore.save(journey);
  const jobContacts = contacts
    .map((phone, i) => ({ phone, pushToken: pushTokens[i] || "" }))
    .filter((c) => c.phone || c.pushToken);
  const escContacts =
    Array.isArray(journey.contacts) && journey.contacts.length > 0 ? journey.contacts : jobContacts;
  let run;
  try {
    const out = await runJourneyEscalation({ journey, reason: decision.reason, contacts: escContacts });
    run = { kind, key, at: now, reason: decision.reason, sent: out.sent, failed: out.failed, receipts: out.receipts };
  } catch (err) {
    const idx = journey.escalation.runs.indexOf(reservation);
    if (idx >= 0) journey.escalation.runs.splice(idx, 1);
    journeyStore.save(journey);
    console.log("❌ ERROR:", err.message);
    return res.status(500).json({ success: false, error: "Journey escalation failed" });
  }
  const idx = journey.escalation.runs.indexOf(reservation);
  if (idx >= 0) journey.escalation.runs[idx] = run;
  else journey.escalation.runs.push(run);
  journeyStore.save(journey);
  audit("journey.escalate_run", {
    ip: req.ip,
    meta: { journeyId: journey.id, kind, reason: decision.reason, sent: run.sent, failed: run.failed },
  });
  res.json({
    success: true,
    journeyId: journey.id,
    state: journey.state,
    reason: decision.reason,
    sent: run.sent,
    failed: run.failed,
    escalation: journey.escalation,
  });
});

// 🗺️ CONTACTS-SIDE JOURNEY PAGE (plan §6 D16 "trip create/share").
//
// Auth is the per-journey view token (services/journeyView.js),
// NOT the API key: contacts have no app and no key. The token is
// minted at create time and travels inside the share link to the
// traveller's chosen contacts only. A missing/wrong token is 401,
// an unknown id 404, a finished journey 410 (its location is stale
// history, not a live trip — serving it would mislead a contact
// into watching an old pin). Rate-limited on the tracking bucket:
// the token is 256-bit HMAC over a UUID, so guessing is infeasible,
// but an open browser endpoint still gets a bucket.
//
// The page reflects ONLY numbers (coordinates), an enum state, an
// ISO timestamp and the sanitized destination label — no name or
// message text — so there is nothing user-controlled left to escape
// beyond the label (escaped below). It carries Referrer-Policy:
// no-referrer: the token lives in this page's URL query, and a
// normal link click would otherwise leak it to Google/OSM in the
// Referer header. Auto-refresh is a meta refresh (no JavaScript):
// the refreshed URL is this same URL, token included.
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const loadViewableJourney = async (req, res) => {
  const journeyId = req.params.id;
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!verifyJourneyToken(journeyId, token)) {
    audit("journey.view_denied", { ip: req.ip, meta: { journeyId } });
    res.status(401).json({ success: false, error: "Invalid or missing view token" });
    return null;
  }
  const journey = await journeyStore.get(journeyId);
  if (!journey) {
    res.status(404).json({ success: false, error: "Journey not found" });
    return null;
  }
  if (journey.state !== "active") {
    res.status(410).json({ success: false, error: "This journey has ended" });
    return null;
  }
  audit("journey.view", { ip: req.ip, meta: { journeyId } });
  return journey;
};

const renderJourneyPage = (journey) => {
  const view = toView(journey);
  const lat = Number(view.lat);
  const lng = Number(view.lng);
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng);
  const at = escapeHtml(view.locationAt || view.updatedAt || "");
  const state = escapeHtml(view.state || "");
  const label = escapeHtml(view.destination.label || "Destination");
  const eta = escapeHtml(view.expectedArrivalAt || "");
  const overdue = view.overdue;
  // D17: the pending check-in is the most useful line on this page
  // — a contact who sees it knows the traveller was asked and has
  // not answered yet, which is the moment to call. The reason is a
  // fixed enum word (overdue/deviated/stopped), never free text.
  const checkIn = publicCheckIn(journey);
  const checkInLine = checkIn
    ? `<p class="overdue">\u26a0\ufe0f Check-in asked (${escapeHtml(checkIn.reason)}) \u2014 the traveller has not answered yet. Try calling them.</p>`
    : ``;
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
<title>SafeLife live journey</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.4rem}.pin{font-size:1.1rem}.muted{color:#555}.overdue{color:#b00020;font-weight:700}iframe{width:100%;height:320px;border:1px solid #ccc}</style>
</head>
<body>
<h1>🧭 SafeLife live journey</h1>
<p>Heading to: <strong>${label}</strong></p>
<p>Status: <strong>${state}</strong></p>
<p>Expected arrival: <strong>${eta}</strong></p>
${overdue ? `<p class="overdue">⚠️ Overdue — the traveller has not arrived by the expected time. Try calling them.</p>` : ``}
${checkInLine}
<p class="muted">Last location update: ${at}</p>
${
  hasFix
    ? `<p class="pin">📍 ${lat}, ${lng}</p>
<p><a href="${mapsUrl}" rel="noreferrer" target="_blank">Open in Google Maps</a></p>
<iframe title="Live journey map" src="${embedUrl}"></iframe>`
    : `<p>No location is available for this journey yet.</p>`
}
<p class="muted">This page refreshes every 30 seconds. If this is an emergency, call the person directly — do not rely on this page alone.</p>
</body>
</html>`;
};

router.get("/journey/:id/view", trackingLimiter, async (req, res) => {
  const journey = await loadViewableJourney(req, res);
  if (!journey) return;
  res.set("Referrer-Policy", "no-referrer");
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.openstreetmap.org; base-uri 'none'"
  );
  res.type("html").send(renderJourneyPage(journey));
});

// 📍 LIVE POSITION (JSON twin of the view page, same token auth).
// Lets a future client poll without scraping HTML; the page itself
// uses meta refresh and never calls this.
router.get("/journey/:id/location", trackingLimiter, async (req, res) => {
  const journey = await loadViewableJourney(req, res);
  if (!journey) return;
  const view = toView(journey);
  res.json({
    success: true,
    journeyId: view.id,
    state: view.state,
    destination: view.destination,
    expectedArrivalAt: view.expectedArrivalAt,
    lat: view.lat,
    lng: view.lng,
    locationAt: view.locationAt,
    overdue: view.overdue,
    watch: publicWatch(journey),
    checkIn: publicCheckIn(journey),
  });
});

module.exports = router;
