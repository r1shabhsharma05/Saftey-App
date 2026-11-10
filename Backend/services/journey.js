// 🧭 Journey Guardian lifecycle — SafeLife 2.0 Day 16 (plan §6 D16,
// plan §3 F4). A journey is a trip the user shares with contacts:
// "I'm heading to X, ETA 25 min" — contacts watch the live pin on a
// share link until the user marks arrived (or cancels).
//
// States: active → arrived | cancelled. Both ends are terminal.
// `overdue` is a COMPUTED read-only flag (now > expectedArrivalAt
// while active) — D17 owns deviation/overdue detection and
// escalation, so nothing here schedules, sends, or escalates.
//
// Serverless note (amendment A2): there is no WebSocket and no
// long-lived process to hold one — Vercel freezes the function
// between requests. Live tracking is REST polling on the alert
// cadence (≥25 m / ≥30 s, same as /location-update): the app posts
// positions, the contacts-side page meta-refreshes every 30 s.
// Upstash pub/sub is not used — Upstash is unconfigured, and a
// subscribe channel needs a persistent connection the app has no
// use for when polling already matches the page refresh.
//
// Pure module, no I/O: routes own persistence (services/
// journeyStore.js). Throws on invalid input / illegal transitions —
// callers must never silently record a journey the machine cannot
// be in.
const crypto = require("crypto");

const JOURNEY_STATES = ["active", "arrived", "cancelled"];

const ALLOWED_TRANSITIONS = {
  active: ["arrived", "cancelled"],
  arrived: [],
  cancelled: [],
};

// A journey longer than 12 h is a data error, not a trip — it bounds
// the ETA window the app can request (and the memory the store can
// hold for one journey). 60 s grace on "in the past": the phone's
// clock can run a little ahead of the server's, and an ETA a few
// seconds stale is still a live trip, not a lie.
const MAX_JOURNEY_MS = 12 * 60 * 60 * 1000;
const ETA_GRACE_MS = 60 * 1000;

const isValidCoord = (v, min, max) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

// D18: the OSRM walking polyline the app sends at create time, so
// deviation is measured against the road actually walked instead of
// the straight line (a real 18 km route wanders 3 km off the line).
// {lat,lng} objects only — anything else is dropped, never stored —
// capped at 1000 points (an 18 km walk is ~500; 25 km is the route
// cap, so 1000 leaves headroom). A missing/empty route means the
// D17 straight-line measure (old records, or a create whose /route
// fetch failed).
const MAX_ROUTE_POINTS = 1000;

const normalizeRoute = (route) => {
  if (!Array.isArray(route)) return [];
  return route
    .filter(
      (p) =>
        p && typeof p === "object" &&
        isValidCoord(p.lat, -90, 90) && isValidCoord(p.lng, -180, 180)
    )
    .slice(0, MAX_ROUTE_POINTS)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
};

const createJourney = ({
  originLat,
  originLng,
  destLat,
  destLng,
  destinationLabel,
  expectedArrivalAt,
  userName,
  contacts = [],
  route = [],
} = {}) => {
  if (!isValidCoord(originLat, -90, 90)) throw new Error("Invalid origin latitude");
  if (!isValidCoord(originLng, -180, 180)) throw new Error("Invalid origin longitude");
  if (!isValidCoord(destLat, -90, 90)) throw new Error("Invalid destination latitude");
  if (!isValidCoord(destLng, -180, 180)) throw new Error("Invalid destination longitude");
  const label = typeof destinationLabel === "string" ? destinationLabel.trim() : "";
  if (!label) throw new Error("Invalid destination label");
  const etaMs = Date.parse(expectedArrivalAt);
  const now = Date.now();
  if (!Number.isFinite(etaMs) || etaMs < now - ETA_GRACE_MS || etaMs > now + MAX_JOURNEY_MS) {
    throw new Error("Invalid expected arrival time");
  }
  const createdAt = new Date().toISOString();
  const journey = {
    id: crypto.randomUUID(),
    state: "active",
    userName: typeof userName === "string" ? userName : "",
    origin: { lat: originLat, lng: originLng },
    destination: { lat: destLat, lng: destLng, label },
    expectedArrivalAt: new Date(etaMs).toISOString(),
    createdAt,
    updatedAt: createdAt,
    // The live pin starts at the origin — the trigger position, so
    // the share page has something to show before the first
    // /location post arrives (same pattern as alerts, D9).
    lat: originLat,
    lng: originLng,
    locationAt: createdAt,
    // D17 watch state: lastMovedAt is the last post that moved the
    // pin ≥25 m (services/journeyWatch.js keeps it); checkIn is the
    // pending "Sab theek hai?" prompt, lastOk* the traveller's last
    // "I'm OK" (suppresses re-prompting for that reason, 10 min);
    // escalation records scheduled QStash jobs + callback runs.
    // contacts are the escalation recipients, capped at 10 — the
    // route normalizes them; the store never fans out by itself.
    // None of these are mirrored to Supabase yet (see
    // journeyStore.js toRow): the mirror is unconfigured, and the
    // escalation job body carries the contacts as its fallback.
    lastMovedAt: createdAt,
    checkIn: null,
    lastOkAt: null,
    lastOkReason: null,
    escalation: { scheduled: [], runs: [] },
    contacts: (Array.isArray(contacts) ? contacts : [])
      .slice(0, 10)
      .map((c) => ({
        phone: typeof c?.phone === "string" ? c.phone : "",
        pushToken: typeof c?.pushToken === "string" ? c.pushToken : "",
      }))
      .filter((c) => c.phone || c.pushToken),
    route: normalizeRoute(route),
    history: [{ state: "active", at: createdAt }],
  };
  return journey;
};

// Records a newer live position. NOT a lifecycle transition —
// location is orthogonal to the state machine, and the route decides
// whether a finished journey still accepts positions (it does not).
const setJourneyLocation = (journey, lat, lng) => {
  const now = new Date().toISOString();
  journey.lat = lat;
  journey.lng = lng;
  journey.locationAt = now;
  journey.updatedAt = now;
  return journey;
};

// Moves the journey, records the step, and returns it. Throws on an
// illegal transition — a swallowed illegal transition would corrupt
// the overdue accounting D17 builds on.
const transition = (journey, to, note) => {
  const allowed = ALLOWED_TRANSITIONS[journey.state] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal journey transition ${journey.state} -> ${to}`);
  }
  journey.state = to;
  journey.updatedAt = new Date().toISOString();
  journey.history.push({ state: to, at: journey.updatedAt, ...(note ? { note } : {}) });
  return journey;
};

// Read-only derived flag: an active journey past its ETA is overdue.
// Arrived/cancelled journeys are never overdue — their trip is over,
// and flagging one would send D17's escalation after the user got
// home safe. `nowMs` is injectable so tests don't race the clock.
const isOverdue = (journey, nowMs = Date.now()) =>
  journey.state === "active" && Date.parse(journey.expectedArrivalAt) < nowMs;

// Public shape for GET /journey/:id — the key-holding caller (the
// victim's own app) sees everything except the transition history.
const toPublic = (journey, nowMs = Date.now()) => ({
  id: journey.id,
  state: journey.state,
  userName: journey.userName,
  origin: journey.origin,
  destination: journey.destination,
  expectedArrivalAt: journey.expectedArrivalAt,
  createdAt: journey.createdAt,
  updatedAt: journey.updatedAt,
  lat: journey.lat ?? null,
  lng: journey.lng ?? null,
  locationAt: journey.locationAt ?? null,
  overdue: isOverdue(journey, nowMs),
});

// Contacts-side shape for the share page — destination + live pin
// only. No name (the link arrives inside the user's own share
// message), no origin (where the trip started is not the contacts'
// business once it is moving), no history.
const toView = (journey, nowMs = Date.now()) => ({
  id: journey.id,
  state: journey.state,
  destination: journey.destination,
  expectedArrivalAt: journey.expectedArrivalAt,
  createdAt: journey.createdAt,
  updatedAt: journey.updatedAt,
  lat: journey.lat ?? null,
  lng: journey.lng ?? null,
  locationAt: journey.locationAt ?? null,
  overdue: isOverdue(journey, nowMs),
});

module.exports = {
  JOURNEY_STATES,
  ALLOWED_TRANSITIONS,
  MAX_JOURNEY_MS,
  MAX_ROUTE_POINTS,
  normalizeRoute,
  createJourney,
  transition,
  setJourneyLocation,
  isOverdue,
  toPublic,
  toView,
};
