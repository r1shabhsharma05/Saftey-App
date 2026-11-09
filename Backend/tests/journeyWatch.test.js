// 🧭 Journey watch — deviation + stop + overstay detection, check-in
// prompt state (SafeLife 2.0 Day 17, plan §6 D17, plan §3 F4).
//
// Pure service tests: no I/O, no timers, no QStash. Time is injected
// (nowMs) so nothing races the clock. Coordinates are real Mathura
// streets: origin GLA University (27.6057, 77.5933) → destination
// Mathura Junction (27.4924, 77.6737), ~13 km apart — a real trip,
// so the deviation numbers below are hand-checked metres, not
// values copied from the implementation.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createJourney, setJourneyLocation } = require("../services/journey");
const {
  DEVIATION_THRESHOLD_M,
  STOPPED_AFTER_MS,
  CHECKIN_GRACE_MS,
  CHECKIN_OK_COOLDOWN_MS,
  deviationM,
  isDeviated,
  isStopped,
  recordJourneyLocation,
  watchStatus,
  publicWatch,
  publicCheckIn,
} = require("../services/journeyWatch");

const ORIGIN = { lat: 27.6057, lng: 77.5933 };
const DEST = { lat: 27.4924, lng: 77.6737 };

// A fresh active journey, ETA 25 min out. lastMovedAt starts at
// creation — a trip that never moved has not "stopped" yet.
const makeJourney = (etaMinutes = 25) =>
  createJourney({
    originLat: ORIGIN.lat,
    originLng: ORIGIN.lng,
    destLat: DEST.lat,
    destLng: DEST.lng,
    destinationLabel: "Mathura Junction",
    expectedArrivalAt: new Date(Date.now() + etaMinutes * 60 * 1000).toISOString(),
    userName: "Test Traveller",
  });

// Midpoint of the straight origin→destination line, nudged east by
// ~600 m (0.006° lng ≈ 590 m at this latitude) — off the line by
// more than the 500 m threshold. Nudged ~200 m (0.002°) stays under it.
const MID = { lat: (ORIGIN.lat + DEST.lat) / 2, lng: (ORIGIN.lng + DEST.lng) / 2 };

test("deviationM is ~0 on the line and ~600 m for a 0.006° lng nudge", () => {
  const j = makeJourney();
  setJourneyLocation(j, MID.lat, MID.lng);
  assert.ok(deviationM(j) < 5, `on-line pin must read ~0, got ${deviationM(j)}`);
  setJourneyLocation(j, MID.lat, MID.lng + 0.006);
  const off = deviationM(j);
  assert.ok(off > 500 && off < 700, `0.006° nudge must read ~590 m, got ${off}`);
});

test("deviationM measures to the nearest endpoint past the line ends", () => {
  const j = makeJourney();
  // 1 km due north of the origin — past the start of the segment.
  setJourneyLocation(j, ORIGIN.lat + 0.009, ORIGIN.lng);
  const d = deviationM(j);
  assert.ok(d > 900 && d < 1100, `past-origin pin must read ~1 km, got ${d}`);
});

test("deviationM is the distance to the point when origin == destination", () => {
  const j = createJourney({
    originLat: ORIGIN.lat,
    originLng: ORIGIN.lng,
    destLat: ORIGIN.lat,
    destLng: ORIGIN.lng,
    destinationLabel: "Same place",
    expectedArrivalAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  });
  setJourneyLocation(j, ORIGIN.lat, ORIGIN.lng + 0.006);
  const d = deviationM(j);
  assert.ok(d > 500 && d < 700, `zero-length route must read ~590 m, got ${d}`);
});

test("isDeviated trips at 500 m and not below it", () => {
  const j = makeJourney();
  setJourneyLocation(j, MID.lat, MID.lng + 0.002);
  assert.equal(isDeviated(j), false);
  setJourneyLocation(j, MID.lat, MID.lng + 0.006);
  assert.equal(isDeviated(j), true);
  assert.equal(isDeviated(j, 1000), false, "a higher threshold must not trip");
});

test("isStopped needs 10 min without a ≥25 m move, and not near the destination", () => {
  const now = Date.now();
  const j = makeJourney();
  // Parked at the midpoint 11 min ago — far from the destination.
  setJourneyLocation(j, MID.lat, MID.lng);
  j.lastMovedAt = new Date(now - 11 * 60 * 1000).toISOString();
  assert.equal(isStopped(j, now), true);
  // 5 min ago is not a stop.
  j.lastMovedAt = new Date(now - 5 * 60 * 1000).toISOString();
  assert.equal(isStopped(j, now), false);
  // 11 min without moving 150 m from the destination is arrival, not a stop.
  setJourneyLocation(j, DEST.lat, DEST.lng + 0.0015);
  j.lastMovedAt = new Date(now - 11 * 60 * 1000).toISOString();
  assert.equal(isStopped(j, now), false);
});

test("recordJourneyLocation only refreshes lastMovedAt on a real ≥25 m move", () => {
  const j = makeJourney();
  const created = j.lastMovedAt;
  assert.equal(created, j.createdAt, "a new journey has not moved yet");
  // Same pin re-posted: not a move.
  recordJourneyLocation(j, ORIGIN.lat, ORIGIN.lng);
  assert.equal(j.lastMovedAt, created);
  // 100 m east: a move. nowMs is pinned 1 s ahead so the new
  // timestamp cannot coincide with creation in the same millisecond.
  recordJourneyLocation(j, ORIGIN.lat, ORIGIN.lng + 0.001, Date.now() + 1000);
  assert.notEqual(j.lastMovedAt, created);
});

test("watchStatus precedence is overdue > deviated > stopped, and ok when clear", () => {
  const now = Date.now();
  const j = makeJourney(); // fresh journey, then rewind its ETA past due
  j.expectedArrivalAt = new Date(now - 60 * 1000).toISOString();
  setJourneyLocation(j, MID.lat, MID.lng + 0.006); // also deviated
  j.lastMovedAt = new Date(now - 11 * 60 * 1000).toISOString(); // also stopped
  const w = watchStatus(j, now);
  assert.equal(w.reason, "overdue");
  assert.equal(w.overdue, true);
  assert.equal(w.deviated, true);
  assert.equal(w.stopped, true);
  assert.equal(w.needsCheckIn, true);

  const j2 = makeJourney();
  setJourneyLocation(j2, MID.lat, MID.lng);
  assert.equal(watchStatus(j2, now).reason, null);
  assert.equal(watchStatus(j2, now).needsCheckIn, false);
});

test("an OK answer suppresses re-prompt for the same reason for 10 min, not another reason", () => {
  const now = Date.now();
  const j = makeJourney();
  setJourneyLocation(j, MID.lat, MID.lng + 0.006); // deviated
  j.lastOkAt = new Date(now - 2 * 60 * 1000).toISOString();
  j.lastOkReason = "deviated";
  assert.equal(watchStatus(j, now).needsCheckIn, false, "same reason inside cooldown must not re-prompt");
  j.lastOkReason = "overdue";
  assert.equal(watchStatus(j, now).needsCheckIn, true, "a different reason must still prompt");
  j.lastOkReason = "deviated";
  j.lastOkAt = new Date(now - 11 * 60 * 1000).toISOString();
  assert.equal(watchStatus(j, now).needsCheckIn, true, "cooldown expiry must re-prompt");
});

test("a finished journey is never watched", () => {
  const now = Date.now();
  const j = makeJourney();
  j.expectedArrivalAt = new Date(now - 60 * 1000).toISOString();
  j.state = "arrived";
  const w = watchStatus(j, now);
  assert.equal(w.reason, null);
  assert.equal(w.needsCheckIn, false);
});

test("publicWatch and publicCheckIn expose only the prompt the app needs", () => {
  const now = Date.now();
  const j = makeJourney();
  setJourneyLocation(j, MID.lat, MID.lng + 0.006);
  const w = publicWatch(j, now);
  assert.equal(w.status, "deviated");
  assert.equal(w.overdue, false);
  assert.equal(w.deviationM > 500, true);
  assert.equal(publicCheckIn(j), null);
  j.checkIn = { reason: "deviated", askedAt: new Date(now).toISOString(), dueAt: new Date(now + CHECKIN_GRACE_MS).toISOString() };
  const c = publicCheckIn(j);
  assert.equal(c.reason, "deviated");
  assert.equal(typeof c.askedAt, "string");
  assert.equal(typeof c.dueAt, "string");
  assert.equal(c.askedAt < c.dueAt, true);
});

test("threshold constants are the values the plan's safety case assumes", () => {
  assert.equal(DEVIATION_THRESHOLD_M, 500);
  assert.equal(STOPPED_AFTER_MS, 10 * 60 * 1000);
  assert.equal(CHECKIN_GRACE_MS, 5 * 60 * 1000);
  assert.equal(CHECKIN_OK_COOLDOWN_MS, 10 * 60 * 1000);
});
