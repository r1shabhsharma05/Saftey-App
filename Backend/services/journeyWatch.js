// 🧭 Journey watch — deviation + stop + overstay detection, check-in
// prompt state (SafeLife 2.0 Day 17, plan §6 D17, plan §3 F4).
//
// The plan: "route se bhatke ya unexpected lamba stop → app pehle
// user ko puchega 'Sab theek hai?' — jawab nahi → auto-escalation
// contacts ko", and "expected time pe na pahunche → auto-alert".
// This module is the DETECTION half only — pure, no I/O, no timers,
// no sending. Scheduling + fan-out live in services/
// journeyEscalation.js; the routes own when to ask.
//
// Deviation is the perpendicular distance from the live pin to the
// straight origin→destination segment, computed on an equirectangular
// projection around the segment midpoint. A straight line is not the
// walked route (D14's OSRM polyline is), but the journey record
// stores no polyline — and a 500 m straight-line deviation already
// means the traveller is a different street away. Using the polyline
// would need the app to send it at create time; D18 candidate, not
// D17 scope. The projection error is <1% at these distances.
// A stop is 10 min without a ≥25 m move (the posting cadence's own
// move threshold) while still >200 m from the destination — parked
// at the door is arrival, not a stop. Overstay reuses D16's
// computed `overdue` flag, so the three reasons share one precedence:
// overdue > deviated > stopped.
//
// An "I'm OK" answer suppresses re-prompting for the SAME reason for
// 10 min — a traveller who knowingly detoured must not be nagged
// every 30 s — but a different reason still prompts: OK-to-deviation
// is not OK-to-overdue.
const { isOverdue, setJourneyLocation } = require("./journey");
const { haversineKm } = require("./safePlaces");

const DEVIATION_THRESHOLD_M = 500;
const STOPPED_AFTER_MS = 10 * 60 * 1000;
const STOPPED_NEAR_DEST_M = 200;
const CHECKIN_GRACE_MS = 5 * 60 * 1000;
const CHECKIN_OK_COOLDOWN_MS = 10 * 60 * 1000;
const MOVE_THRESHOLD_M = 25;

const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// Local metres around (lat0, lng0): x east, y north.
const project = (lat, lng, lat0, lng0) => ({
  x: (lng - lng0) * toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(lat0)),
  y: (lat - lat0) * toRad(1) * EARTH_RADIUS_M,
});

// Metres from the live pin to the origin→destination segment. A pin
// past either end measures to that endpoint; a zero-length route
// (origin == destination) measures to the point.
const deviationM = (journey) => {
  if (!journey || typeof journey.lat !== "number" || typeof journey.lng !== "number") return 0;
  const o = journey.origin;
  const d = journey.destination;
  if (!o || !d) return 0;
  const lat0 = (o.lat + d.lat) / 2;
  const lng0 = (o.lng + d.lng) / 2;
  const p = project(journey.lat, journey.lng, lat0, lng0);
  const a = project(o.lat, o.lng, lat0, lng0);
  const b = project(d.lat, d.lng, lat0, lng0);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const isDeviated = (journey, thresholdM = DEVIATION_THRESHOLD_M) =>
  journey?.state === "active" && deviationM(journey) > thresholdM;

// `lastMovedAt` is the last post that moved the pin ≥25 m (kept by
// recordJourneyLocation, below). A journey whose phone keeps posting
// the same pin is stationary — the check is movement, not posting.
// Falls back to locationAt/createdAt for records written before D17.
const lastMovedMs = (journey) =>
  Date.parse(journey?.lastMovedAt || journey?.locationAt || journey?.createdAt || "") || 0;

const isStopped = (journey, nowMs = Date.now()) => {
  if (!journey || journey.state !== "active") return false;
  if (nowMs - lastMovedMs(journey) < STOPPED_AFTER_MS) return false;
  if (typeof journey.lat !== "number" || typeof journey.lng !== "number") return false;
  const dest = journey.destination;
  if (!dest) return false;
  return haversineKm(journey.lat, journey.lng, dest.lat, dest.lng) * 1000 > STOPPED_NEAR_DEST_M;
};

// An OK answer covers its own reason for 10 min. Anything else —
// no answer, another reason, cooldown expired — needs a prompt.
const recentlyOkFor = (journey, reason, nowMs) => {
  if (!journey || journey.lastOkReason !== reason || !journey.lastOkAt) return false;
  const okMs = Date.parse(journey.lastOkAt);
  return Number.isFinite(okMs) && nowMs - okMs < CHECKIN_OK_COOLDOWN_MS;
};

const watchStatus = (journey, nowMs = Date.now()) => {
  // All three flags are computed independently — a trip can be
  // overdue AND deviated AND stopped at once. `reason` picks the
  // one the check-in prompt names, in safety order.
  const overdue = isOverdue(journey, nowMs);
  const deviated = isDeviated(journey);
  const stopped = isStopped(journey, nowMs);
  const reason = overdue ? "overdue" : deviated ? "deviated" : stopped ? "stopped" : null;
  return {
    overdue,
    deviated,
    stopped,
    deviationM: Math.round(deviationM(journey)),
    stoppedForMs: reason === "stopped" ? nowMs - lastMovedMs(journey) : 0,
    reason,
    needsCheckIn: reason !== null && !recentlyOkFor(journey, reason, nowMs),
  };
};

// Records a live position AND the movement bookkeeping the stop
// detector needs. journey.js stays pure (no geo imports): the route
// calls this instead of setJourneyLocation. A first fix (null pin,
// e.g. a DB-restored journey) counts as a move.
const recordJourneyLocation = (journey, lat, lng, nowMs = Date.now()) => {
  const moved =
    typeof journey.lat !== "number" ||
    typeof journey.lng !== "number" ||
    haversineKm(journey.lat, journey.lng, lat, lng) * 1000 >= MOVE_THRESHOLD_M;
  setJourneyLocation(journey, lat, lng);
  if (moved) journey.lastMovedAt = new Date(nowMs).toISOString();
  return journey;
};

// The check-in the app must show: reason + the window the traveller
// has to answer. Nothing else — no contacts, no internals.
const newCheckIn = (reason, nowMs = Date.now()) => ({
  reason,
  askedAt: new Date(nowMs).toISOString(),
  dueAt: new Date(nowMs + CHECKIN_GRACE_MS).toISOString(),
});

const publicCheckIn = (journey) => {
  const c = journey?.checkIn;
  if (!c || typeof c.reason !== "string" || typeof c.askedAt !== "string" || typeof c.dueAt !== "string") {
    return null;
  }
  return { reason: c.reason, askedAt: c.askedAt, dueAt: c.dueAt };
};

// Owner + contacts shapes carry the same watch: the app polls the
// owner shape, the share page shows the contacts one.
const publicWatch = (journey, nowMs = Date.now()) => {
  const w = watchStatus(journey, nowMs);
  return {
    status: w.reason ?? "ok",
    overdue: w.overdue,
    deviated: w.deviated,
    stopped: w.stopped,
    deviationM: w.deviationM,
  };
};

module.exports = {
  DEVIATION_THRESHOLD_M,
  STOPPED_AFTER_MS,
  STOPPED_NEAR_DEST_M,
  CHECKIN_GRACE_MS,
  CHECKIN_OK_COOLDOWN_MS,
  MOVE_THRESHOLD_M,
  deviationM,
  isDeviated,
  isStopped,
  watchStatus,
  recordJourneyLocation,
  newCheckIn,
  publicCheckIn,
  publicWatch,
};
