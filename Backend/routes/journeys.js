// 🧭 Journey Guardian routes — trip create/share + live tracking
// (SafeLife 2.0 Day 16, plan §6 D16, plan §3 F4).
//
// Guard matrix (explicit, in one place): every mutating route is
// API-key gated + tracking-limited. Creating a journey does NOT fan
// out to contacts — the response carries a share link and the
// traveller sends it (native share sheet); the server stores no
// contact list for a journey (D17's escalation job will carry the
// contacts in its own body when it schedules the overdue check).
// The contacts-side view page is token-gated, mirroring D9's alert
// page: contacts have no app and no key, and the token is minted at
// create time and travels inside the share link only.
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
const {
  createJourney,
  transition,
  setJourneyLocation,
  toPublic,
  toView,
} = require("../services/journey");
const journeyStore = require("../services/journeyStore");
const { journeyToken, verifyJourneyToken } = require("../services/journeyView");
const { audit } = require("../services/audit");

const router = express.Router();

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
  // Share link: only when both halves exist — a public base URL to
  // point at, and a signing secret to mint the per-journey token
  // with. Without either, no link is emitted (same honest rule as
  // D9's alert-view link: a link that 401s for every contact would
  // look like the system is broken rather than unconfigured).
  const viewBase = publicBaseUrl();
  const token = journeyToken(journey.id);
  const viewUrl =
    viewBase && token ? `${viewBase}/journey/${journey.id}/view?token=${token}` : null;
  res.json({ success: true, journey: toPublic(journey), viewUrl });
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
  res.json({ success: true, journey: toPublic(journey) });
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
  setJourneyLocation(journey, toNumber(lat), toNumber(lng));
  journeyStore.save(journey);
  res.json({ success: true, journey: toPublic(journey) });
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
  res.json({ success: true, journey: toPublic(journey) });
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
  res.json({ success: true, journey: toPublic(journey) });
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
  });
});

module.exports = router;
