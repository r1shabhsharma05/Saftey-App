// SafeLife 2.0 Day 16 — Journey Guardian service tests (plan §6 D16,
// plan §3 F4). Pure lifecycle: create → active → arrived | cancelled.
// Overdue is a computed read-only flag here — D17 owns detection +
// escalation, so nothing in this module schedules or sends anything.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  JOURNEY_STATES,
  createJourney,
  transition,
  setJourneyLocation,
  isOverdue,
  toPublic,
  toView,
} = require("../services/journey");

const NOW = Date.now();
const inMinutes = (m) => new Date(NOW + m * 60 * 1000).toISOString();

const validInput = () => ({
  originLat: 28.6139,
  originLng: 77.209,
  destLat: 28.62,
  destLng: 77.215,
  destinationLabel: "Connaught Place",
  expectedArrivalAt: inMinutes(25),
  userName: "Rishabh Sharma",
});

test("create: valid input starts active with origin, destination and ETA", () => {
  const j = createJourney(validInput());
  assert.equal(j.state, "active");
  assert.equal(typeof j.id, "string");
  assert.deepEqual(j.origin, { lat: 28.6139, lng: 77.209 });
  assert.deepEqual(j.destination, { lat: 28.62, lng: 77.215, label: "Connaught Place" });
  assert.equal(j.expectedArrivalAt, inMinutes(25));
  assert.equal(j.userName, "Rishabh Sharma");
  assert.equal(j.lat, 28.6139);
  assert.equal(j.lng, 77.209);
  assert.equal(typeof j.locationAt, "string");
  assert.deepEqual(j.history, [{ state: "active", at: j.createdAt }]);
});

test("create: origin defaults the live position; destination label trims", () => {
  const j = createJourney({ ...validInput(), destinationLabel: "  Home  " });
  assert.equal(j.destination.label, "Home");
});

test("create: rejects out-of-range or non-finite coordinates", () => {
  assert.throws(() => createJourney({ ...validInput(), originLat: 91 }), /origin latitude/);
  assert.throws(() => createJourney({ ...validInput(), destLng: -181 }), /destination longitude/);
  assert.throws(() => createJourney({ ...validInput(), originLat: "x" }), /origin latitude/);
  assert.throws(() => createJourney({ ...validInput(), destLat: NaN }), /destination latitude/);
});

test("create: rejects an empty destination label", () => {
  assert.throws(() => createJourney({ ...validInput(), destinationLabel: "   " }), /destination label/);
  assert.throws(() => createJourney({ ...validInput(), destinationLabel: 42 }), /destination label/);
});

test("create: rejects an ETA in the past, unparseable, or more than 12h out", () => {
  assert.throws(() => createJourney({ ...validInput(), expectedArrivalAt: inMinutes(-5) }), /expected arrival/);
  assert.throws(() => createJourney({ ...validInput(), expectedArrivalAt: "not-a-date" }), /expected arrival/);
  assert.throws(() => createJourney({ ...validInput(), expectedArrivalAt: inMinutes(13 * 60) }), /expected arrival/);
  // Exactly 12h out is allowed.
  assert.equal(createJourney({ ...validInput(), expectedArrivalAt: inMinutes(12 * 60) }).state, "active");
});

test("transition: active → arrived and active → cancelled are legal", () => {
  const a = createJourney(validInput());
  transition(a, "arrived", "user arrived");
  assert.equal(a.state, "arrived");
  assert.equal(a.history.length, 2);
  assert.equal(a.history[1].note, "user arrived");

  const b = createJourney(validInput());
  transition(b, "cancelled");
  assert.equal(b.state, "cancelled");
});

test("transition: terminal states are terminal, active → active is illegal", () => {
  const a = createJourney(validInput());
  transition(a, "arrived");
  assert.throws(() => transition(a, "cancelled"), /Illegal journey transition arrived -> cancelled/);
  assert.throws(() => transition(a, "arrived"), /Illegal journey transition arrived -> arrived/);
  const b = createJourney(validInput());
  assert.throws(() => transition(b, "active"), /Illegal journey transition active -> active/);
  assert.throws(() => transition(b, "overdue"), /Illegal journey transition/);
});

test("setJourneyLocation: moves the pin without touching the state", () => {
  const j = createJourney(validInput());
  setJourneyLocation(j, 28.615, 77.211);
  assert.equal(j.state, "active");
  assert.equal(j.lat, 28.615);
  assert.equal(j.lng, 77.211);
  assert.equal(typeof j.locationAt, "string");
  assert.equal(j.history.length, 1);
});

test("isOverdue: only an active journey past its ETA is overdue", () => {
  const active = createJourney({ ...validInput(), expectedArrivalAt: inMinutes(25) });
  assert.equal(isOverdue(active, NOW), false);
  assert.equal(isOverdue(active, NOW + 26 * 60 * 1000), true);

  const arrived = createJourney(validInput());
  transition(arrived, "arrived");
  assert.equal(isOverdue(arrived, NOW + 26 * 60 * 1000), false);

  const cancelled = createJourney(validInput());
  transition(cancelled, "cancelled");
  assert.equal(isOverdue(cancelled, NOW + 26 * 60 * 1000), false);
});

test("toPublic: full owner shape with computed overdue, no history", () => {
  const j = createJourney(validInput());
  const pub = toPublic(j, NOW + 26 * 60 * 1000);
  assert.equal(pub.id, j.id);
  assert.equal(pub.state, "active");
  assert.equal(pub.overdue, true);
  assert.equal(pub.userName, "Rishabh Sharma");
  assert.deepEqual(pub.origin, { lat: 28.6139, lng: 77.209 });
  assert.deepEqual(pub.destination, { lat: 28.62, lng: 77.215, label: "Connaught Place" });
  assert.equal(pub.history, undefined);
});

test("toView: contacts-side shape carries no name and no history", () => {
  const j = createJourney(validInput());
  const view = toView(j, NOW);
  assert.equal(view.id, j.id);
  assert.equal(view.state, "active");
  assert.equal(view.overdue, false);
  assert.equal(view.userName, undefined);
  assert.equal(view.origin, undefined);
  assert.deepEqual(view.destination, { lat: 28.62, lng: 77.215, label: "Connaught Place" });
  assert.equal(view.history, undefined);
});

test("JOURNEY_STATES lists the three states", () => {
  assert.deepEqual(JOURNEY_STATES, ["active", "arrived", "cancelled"]);
});
