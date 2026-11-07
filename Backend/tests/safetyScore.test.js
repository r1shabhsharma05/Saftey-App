// SafeLife 2.0 Day 15 — safety scoring v1 (rules) tests.
//
// The rule table lives in services/safetyScore.js and is mirrored by
// the mobile fallback in mobile-app/utils/escapeLogic.ts (the phone's
// direct-Overpass path has no backend annotations). The fixture values
// below are the parity contract: both implementations must return these
// exact scores for these exact inputs.
const test = require("node:test");
const assert = require("node:assert/strict");

const { scorePlace, scoreRoute, bandFor, categoryFromTags } = require("../services/safetyScore");

test("place: police open 0.4 km away scores 100 SAFE (90 + 10 + 5, clamped)", () => {
  assert.deepEqual(scorePlace({ category: "police", distanceKm: 0.4, openNow: true }), {
    score: 100,
    band: "SAFE",
    reasons: ["Police station", "Open now", "400 m away"],
  });
});

test("place: police closed 8 km away scores 55 MODERATE (90 - 25 - 10)", () => {
  assert.deepEqual(scorePlace({ category: "police", distanceKm: 8, openNow: false }), {
    score: 55,
    band: "MODERATE",
    reasons: ["Police station", "Closed now", "8.0 km away"],
  });
});

test("place: hospital, unknown hours, 2.5 km scores 80 SAFE (80 + 0 + 0)", () => {
  assert.deepEqual(scorePlace({ category: "hospital", distanceKm: 2.5, openNow: null }), {
    score: 80,
    band: "SAFE",
    reasons: ["Hospital", "2.5 km away"],
  });
});

test("place: hospital closed 12 km away scores 40 LOW (80 - 25 - 15)", () => {
  assert.deepEqual(scorePlace({ category: "hospital", distanceKm: 12, openNow: false }), {
    score: 40,
    band: "LOW",
    reasons: ["Hospital", "Closed now", "12.0 km away"],
  });
});

test("place: crowd open 0.8 km scores 75 MODERATE (60 + 10 + 5)", () => {
  assert.deepEqual(scorePlace({ category: "crowd", distanceKm: 0.8, openNow: true }), {
    score: 75,
    band: "MODERATE",
    reasons: ["Public place", "Open now", "800 m away"],
  });
});

test("place: crowd closed 6 km scores 25 LOW (60 - 25 - 10)", () => {
  assert.deepEqual(scorePlace({ category: "crowd", distanceKm: 6, openNow: false }), {
    score: 25,
    band: "LOW",
    reasons: ["Public place", "Closed now", "6.0 km away"],
  });
});

test("place: unknown type, no coords, unknown hours scores 50 LOW", () => {
  assert.deepEqual(scorePlace({ category: "other", distanceKm: null, openNow: null }), {
    score: 50,
    band: "LOW",
    reasons: ["Safe place"],
  });
});

test("place: university open 4 km scores 80 SAFE (75 + 10 - 5)", () => {
  assert.deepEqual(scorePlace({ category: "university", distanceKm: 4, openNow: true }), {
    score: 80,
    band: "SAFE",
    reasons: ["University", "Open now", "4.0 km away"],
  });
});

test("place: hostel, unknown hours, exactly 3 km scores 70 MODERATE (distance band edge)", () => {
  assert.deepEqual(scorePlace({ category: "hostel", distanceKm: 3, openNow: null }), {
    score: 70,
    band: "MODERATE",
    reasons: ["Hostel", "3.0 km away"],
  });
});

test("place: distance band edges are exact — 1.0 earns +5, 5.0 costs -5, 10.0 costs -10", () => {
  assert.equal(scorePlace({ category: "other", distanceKm: 1, openNow: null }).score, 55);
  assert.equal(scorePlace({ category: "other", distanceKm: 1.01, openNow: null }).score, 50);
  assert.equal(scorePlace({ category: "other", distanceKm: 5, openNow: null }).score, 45);
  assert.equal(scorePlace({ category: "other", distanceKm: 10, openNow: null }).score, 40);
  assert.equal(scorePlace({ category: "other", distanceKm: 10.01, openNow: null }).score, 35);
});

test("place: unknown category is treated as 'other', never throws", () => {
  assert.equal(scorePlace({ category: "castle", distanceKm: 0.5, openNow: true }).score, 65);
  assert.equal(scorePlace({}).score, 50);
});

test("band: thresholds are 80 SAFE / 55 MODERATE / below 55 LOW", () => {
  assert.equal(bandFor(100), "SAFE");
  assert.equal(bandFor(80), "SAFE");
  assert.equal(bandFor(79), "MODERATE");
  assert.equal(bandFor(55), "MODERATE");
  assert.equal(bandFor(54), "LOW");
  assert.equal(bandFor(0), "LOW");
});

test("route: exposure falls with walking time — 5 min 90, 10 min 80, 15 min 70, 30 min 55, over 40", () => {
  assert.deepEqual(scoreRoute({ distanceM: 350, durationS: 240 }), {
    score: 90,
    band: "SAFE",
    reasons: ["4 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 700, durationS: 300 }), {
    score: 90,
    band: "SAFE",
    reasons: ["5 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 800, durationS: 301 }), {
    score: 80,
    band: "SAFE",
    reasons: ["5 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 1200, durationS: 600 }), {
    score: 80,
    band: "SAFE",
    reasons: ["10 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 1600, durationS: 900 }), {
    score: 70,
    band: "MODERATE",
    reasons: ["15 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 2500, durationS: 1800 }), {
    score: 55,
    band: "MODERATE",
    reasons: ["30 min walk"],
  });
  assert.deepEqual(scoreRoute({ distanceM: 4000, durationS: 1801 }), {
    score: 40,
    band: "LOW",
    reasons: ["30 min walk"],
  });
});

test("route: zero duration is a 90, not a crash", () => {
  assert.equal(scoreRoute({ distanceM: 0, durationS: 0 }).score, 90);
});

test("categoryFromTags: same order as the mobile parser — police, university, hospital, hostel, crowd, other", () => {
  assert.equal(categoryFromTags({ amenity: "police" }), "police");
  assert.equal(categoryFromTags({ amenity: "university" }), "university");
  assert.equal(categoryFromTags({ amenity: "college" }), "university");
  assert.equal(categoryFromTags({ amenity: "hospital" }), "hospital");
  assert.equal(categoryFromTags({ amenity: "clinic" }), "hospital");
  assert.equal(categoryFromTags({ tourism: "hostel" }), "hostel");
  assert.equal(categoryFromTags({ tourism: "hotel" }), "hostel");
  assert.equal(categoryFromTags({ amenity: "cafe" }), "crowd");
  assert.equal(categoryFromTags({ amenity: "mall" }), "crowd");
  assert.equal(categoryFromTags({ amenity: "bank" }), "crowd");
  assert.equal(categoryFromTags({ amenity: "pharmacy" }), "crowd");
  assert.equal(categoryFromTags({ shop: "supermarket" }), "crowd");
  assert.equal(categoryFromTags({ amenity: "parking" }), "other");
  assert.equal(categoryFromTags({}), "other");
  assert.equal(categoryFromTags(null), "other");
  assert.equal(categoryFromTags(undefined), "other");
});
