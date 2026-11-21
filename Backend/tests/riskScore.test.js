// SafeLife 2.0 Day 29 — ML v1 risk scoring (rules-v1) tests.
// Expected values are hand-computed literals (never derived from the
// WEIGHTS table — a wrong weight must fail here, not re-derive itself).
const test = require("node:test");
const assert = require("node:assert/strict");

const { scoreRisk, extractFeatures, bandForRisk, FEATURE_ORDER } = require("../services/riskScore");

test("daytime crowd, 10 min walk = 34 LOW (30 area + 0 day + 4 duration)", () => {
  const r = scoreRisk({ localHour: 11, areaType: "crowd", routeDurationS: 600 });
  assert.equal(r.score, 34);
  assert.equal(r.band, "LOW");
  assert.deepEqual(r.reasons, ["Area: crowd", "Daytime", "10 min walk"]);
  assert.equal(r.modelVersion, "rules-v1");
});

test("night, unclassified area, 35 min, 250 m off route = 88 HIGH (45+25+12+6)", () => {
  const r = scoreRisk({ localHour: 2, areaType: "other", routeDurationS: 2100, deviationM: 250 });
  assert.equal(r.score, 88);
  assert.equal(r.band, "HIGH");
  assert.ok(r.reasons.includes("Night hours"));
  assert.ok(r.reasons.includes("250 m off route"));
});

test("evening university, 5 min = 30 LOW (20 + 10 evening + 0)", () => {
  const r = scoreRisk({ localHour: 19, areaType: "university", routeDurationS: 300 });
  assert.equal(r.score, 30);
  assert.equal(r.band, "LOW");
});

test("no hour + no duration: police area = 5, unknowns named, never guessed", () => {
  const r = scoreRisk({ areaType: "police" });
  assert.equal(r.score, 5);
  assert.deepEqual(r.unknownFactors, ["time-of-day", "route-duration", "incident-density"]);
  assert.equal(r.features.hourOfDay, null);
});

test("score clamps at 100 (45 + 25 night + 20 duration cap + 25 deviation cap)", () => {
  const r = scoreRisk({ localHour: 23, areaType: "other", routeDurationS: 86400, deviationM: 50000 });
  assert.equal(r.score, 100);
  assert.equal(r.band, "HIGH");
});

test("incidentDensity input never moves the score (weight 0, still unknown)", () => {
  const without = scoreRisk({ localHour: 11, areaType: "crowd", routeDurationS: 600 });
  const withIt = scoreRisk({ localHour: 11, areaType: "crowd", routeDurationS: 600, incidentDensity: 0.99 });
  assert.equal(withIt.score, without.score);
  assert.equal(withIt.features.incidentDensity, 0.99); // recorded for model v2
  assert.ok(withIt.unknownFactors.includes("incident-density"));
});

test("extractFeatures clamps and validates (duration cap, negative deviation, bad area)", () => {
  const { features, known } = extractFeatures({
    localHour: 25, // invalid → unknown, not clamped into a fake hour
    areaType: "mars",
    routeDurationS: 999999,
    deviationM: -5,
  });
  assert.equal(features.hourOfDay, null);
  assert.equal(features.areaType, "other");
  assert.equal(known.areaType, false);
  assert.equal(features.routeDurationS, 86400);
  assert.equal(features.deviationM, 0);
});

test("tz derives the local hour; a bogus tz stays unknown", () => {
  const good = extractFeatures({ tz: "Asia/Kolkata" });
  assert.equal(good.known.hourOfDay, true);
  assert.ok(good.features.hourOfDay >= 0 && good.features.hourOfDay <= 23);
  const bad = extractFeatures({ tz: "Not/AZone" });
  assert.equal(bad.features.hourOfDay, null);
});

test("band edges: 39 LOW, 40 MODERATE, 64 MODERATE, 65 HIGH", () => {
  assert.equal(bandForRisk(39), "LOW");
  assert.equal(bandForRisk(40), "MODERATE");
  assert.equal(bandForRisk(64), "MODERATE");
  assert.equal(bandForRisk(65), "HIGH");
});

test("feature vector carries exactly the fixed-order contract keys", () => {
  const { features } = extractFeatures({ localHour: 9 });
  assert.deepEqual(Object.keys(features).sort(), [...FEATURE_ORDER].sort());
});
