// SafeLife 2.0 Day 29 — anonymised feature logging tests.
// The contract under test is privacy: no identifier can reach a row,
// coordinates exist only as a ~1.1 km cell, and logging never throws.
const test = require("node:test");
const assert = require("node:assert/strict");

const { logFeatureEvent, buildFeatureRow, recentFeatureEvents, coarseCell } = require("../services/featureLog");

test("coarseCell rounds to the 2dp grid and rejects garbage", () => {
  assert.deepEqual(coarseCell(28.6139, 77.209), { cellLat: 28.61, cellLng: 77.21 });
  assert.deepEqual(coarseCell(999, 77.2), { cellLat: null, cellLng: null });
  assert.deepEqual(coarseCell("28.6", null), { cellLat: null, cellLng: null });
});

test("a row carries no identifier keys, whatever the caller passes", () => {
  const row = buildFeatureRow({
    kind: "sos",
    lat: 28.6139,
    lng: 77.209,
    input: { localHour: 23 },
    extra: { triggerSource: "voice", contactsCount: 3, phone: "+919999999999", userId: "u-1", alertId: "a-1" },
  });
  assert.equal(row.kind, "sos");
  assert.equal(row.cellLat, 28.61);
  assert.deepEqual(row.extra, { triggerSource: "voice", contactsCount: 3 });
  const flat = JSON.stringify(row);
  assert.ok(!flat.includes("9999999999"), "phone must never reach the log");
  assert.ok(!flat.includes("u-1") && !flat.includes("a-1"), "ids must never reach the log");
  assert.equal(row.modelVersion, "rules-v1");
  assert.ok(row.score >= 0 && row.score <= 100);
});

test("unknown kind falls back to risk_score; logFeatureEvent never throws", () => {
  const before = recentFeatureEvents().length;
  const row = logFeatureEvent({ kind: "bogus", input: { localHour: 10 } });
  assert.equal(row.kind, "risk_score");
  assert.equal(recentFeatureEvents().length, before + 1);
  assert.doesNotThrow(() => logFeatureEvent(null));
  assert.doesNotThrow(() => logFeatureEvent({ input: "garbage" }));
});

test("DB unconfigured (test env) still logs to the ring — SOS path unaffected", () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const row = logFeatureEvent({ kind: "journey", lat: 28.6, lng: 77.2, input: { localHour: 8 } });
  assert.ok(row);
  assert.equal(row.kind, "journey");
});
