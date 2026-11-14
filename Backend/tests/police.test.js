// Police layer D22 tests — SafeLife 2.0 Day 22: nearest station pick +
// OSM phone allowlist (pure service, no network).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EMERGENCY_NUMBER,
  extractStationPhone,
  nearestPoliceStation,
} = require("../services/police");

// Query point: Connaught Place, Delhi.
const LAT = 28.6315;
const LNG = 77.2167;

const station = (overrides = {}) => ({
  type: "node",
  id: overrides.id ?? 1,
  lat: overrides.lat ?? 28.6315,
  lon: overrides.lng ?? 77.2167,
  tags: overrides.tags ?? { amenity: "police", name: "CP Police Station" },
  distanceKm: overrides.distanceKm,
  openNow: overrides.openNow,
  safety: overrides.safety,
});

test("EMERGENCY_NUMBER is 112", () => {
  assert.equal(EMERGENCY_NUMBER, "112");
});

test("extractStationPhone: phone tag wins, contact:phone is the fallback", () => {
  assert.equal(extractStationPhone({ phone: "011-2345 6789" }), "011-2345 6789");
  assert.equal(
    extractStationPhone({ "contact:phone": "+91 11 2345 6789" }),
    "+91 11 2345 6789"
  );
  assert.equal(
    extractStationPhone({ phone: "011 1111", "contact:phone": "+91 22 2222" }),
    "011 1111"
  );
});

test("extractStationPhone: crowd-edited junk never becomes a dial string", () => {
  assert.equal(extractStationPhone({ phone: "call me" }), null);
  assert.equal(extractStationPhone({ phone: "https://police.example" }), null);
  assert.equal(extractStationPhone({ phone: "tel:112;123" }), null);
  assert.equal(extractStationPhone({ phone: "112" }), null); // too short
  assert.equal(extractStationPhone({ phone: "*#06#" }), null); // USSD/MMI
  assert.equal(extractStationPhone({}), null);
  assert.equal(extractStationPhone({ phone: 112 }), null);
  assert.equal(extractStationPhone(null), null);
});

test("nearest: picks the closest police station by annotated distance", () => {
  const far = station({ id: 2, lat: 28.65, lng: 77.23, distanceKm: 2.1, tags: { amenity: "police", name: "Far Station" } });
  const near = station({ id: 3, lat: 28.632, lng: 77.217, distanceKm: 0.4, tags: { amenity: "police", name: "Near Station", phone: "011-2345 6789" } });
  const got = nearestPoliceStation([far, near], LAT, LNG);
  assert.equal(got.name, "Near Station");
  assert.equal(got.phone, "011-2345 6789");
  assert.equal(got.distanceKm, 0.4);
  assert.equal(got.lat, 28.632);
  assert.equal(got.lng, 77.217);
});

test("nearest: a closer hospital never wins — police only", () => {
  const hospital = station({
    id: 4, distanceKm: 0.1,
    tags: { amenity: "hospital", name: "Near Hospital" },
  });
  const police = station({ id: 5, distanceKm: 3.0, tags: { amenity: "police", name: "Only Station" } });
  assert.equal(nearestPoliceStation([hospital, police], LAT, LNG).name, "Only Station");
});

test("nearest: elements without coordinates are skipped", () => {
  const noCoords = { type: "node", id: 6, tags: { amenity: "police", name: "Ghost Station" }, distanceKm: 0.01 };
  const real = station({ id: 7, distanceKm: 1.2, tags: { amenity: "police", name: "Real Station" } });
  assert.equal(nearestPoliceStation([noCoords, real], LAT, LNG).name, "Real Station");
});

test("nearest: computes distance when the annotation is absent (way center)", () => {
  // ~1.0 km north: 0.009° latitude.
  const el = {
    type: "way", id: 8,
    center: { lat: LAT + 0.009, lon: LNG },
    tags: { amenity: "police", name: "North Station" },
  };
  const got = nearestPoliceStation([el], LAT, LNG);
  assert.equal(got.name, "North Station");
  assert.ok(Math.abs(got.distanceKm - 1.0) < 0.05, `distanceKm ${got.distanceKm} ≈ 1.0`);
  assert.equal(got.lat, LAT + 0.009);
});

test("nearest: carries openNow + safety annotations through", () => {
  const safety = { score: 100, band: "SAFE", reasons: ["Police station", "Open now", "400 m away"] };
  const got = nearestPoliceStation(
    [station({ distanceKm: 0.4, openNow: true, safety })],
    LAT, LNG
  );
  assert.equal(got.openNow, true);
  assert.deepEqual(got.safety, safety);
});

test("nearest: tie on distance — open station wins, then higher score", () => {
  const closed = station({
    id: 9, distanceKm: 1.0, openNow: false,
    safety: { score: 95, band: "SAFE", reasons: [] },
    tags: { amenity: "police", name: "Closed High-Score" },
  });
  const open = station({
    id: 10, distanceKm: 1.0, openNow: true,
    safety: { score: 60, band: "MODERATE", reasons: [] },
    tags: { amenity: "police", name: "Open Low-Score" },
  });
  assert.equal(nearestPoliceStation([closed, open], LAT, LNG).name, "Open Low-Score");
  const highScore = station({
    id: 11, distanceKm: 1.0, openNow: null,
    safety: { score: 90, band: "SAFE", reasons: [] },
    tags: { amenity: "police", name: "High Score" },
  });
  const lowScore = station({
    id: 12, distanceKm: 1.0, openNow: null,
    safety: { score: 70, band: "MODERATE", reasons: [] },
    tags: { amenity: "police", name: "Low Score" },
  });
  assert.equal(nearestPoliceStation([lowScore, highScore], LAT, LNG).name, "High Score");
});

test("nearest: unnamed station keeps name null (client labels it)", () => {
  const got = nearestPoliceStation(
    [station({ distanceKm: 0.5, tags: { amenity: "police" } })],
    LAT, LNG
  );
  assert.equal(got.name, null);
  assert.equal(got.phone, null);
});

test("nearest: no police at all → null, never a fake station", () => {
  assert.equal(nearestPoliceStation([], LAT, LNG), null);
  assert.equal(
    nearestPoliceStation([station({ tags: { amenity: "hospital", name: "H" }, distanceKm: 0.1 })], LAT, LNG),
    null
  );
  assert.equal(nearestPoliceStation(null, LAT, LNG), null);
});
