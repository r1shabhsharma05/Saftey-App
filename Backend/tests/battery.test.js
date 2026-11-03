// Unit tests for services/battery.js — SafeLife 2.0 Day 11 (plan §6 D11,
// plan §2 S1: 15% pre-alert, 5% final burst while an alert is active).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  LOW_BATTERY_THRESHOLD,
  FINAL_BATTERY_THRESHOLD,
  decideBatteryAlert,
  isBatteryLevelInBand,
  buildBatteryMessage,
} = require("../services/battery");

test("thresholds are the plan's 15% / 5% values", () => {
  assert.equal(LOW_BATTERY_THRESHOLD, 15);
  assert.equal(FINAL_BATTERY_THRESHOLD, 5);
});

test("decide: discharging at 15% with no alert → low; at 16% → nothing", () => {
  assert.equal(
    decideBatteryAlert({ level: 15, charging: false, alertActive: false, lowSent: false, finalSent: false }),
    "low"
  );
  assert.equal(
    decideBatteryAlert({ level: 16, charging: false, alertActive: false, lowSent: false, finalSent: false }),
    null
  );
});

test("decide: already-sent low alert never re-fires at a lower level", () => {
  assert.equal(
    decideBatteryAlert({ level: 8, charging: false, alertActive: false, lowSent: true, finalSent: false }),
    null
  );
});

test("decide: charging at 10% → nothing (the phone is not dying)", () => {
  assert.equal(
    decideBatteryAlert({ level: 10, charging: true, alertActive: false, lowSent: false, finalSent: false }),
    null
  );
});

test("decide: unknown charging state does not block a low alert", () => {
  assert.equal(
    decideBatteryAlert({ level: 14, charging: null, alertActive: false, lowSent: false, finalSent: false }),
    "low"
  );
});

test("decide: active alert at 5% → final, and final beats low", () => {
  assert.equal(
    decideBatteryAlert({ level: 5, charging: false, alertActive: true, lowSent: false, finalSent: false }),
    "final"
  );
  assert.equal(
    decideBatteryAlert({ level: 5, charging: false, alertActive: true, lowSent: true, finalSent: false }),
    "final"
  );
});

test("decide: active alert at 5% with final already sent → nothing", () => {
  assert.equal(
    decideBatteryAlert({ level: 5, charging: false, alertActive: true, lowSent: false, finalSent: true }),
    null
  );
});

test("decide: active alert at 12% → nothing (low warnings are for no-alert only)", () => {
  assert.equal(
    decideBatteryAlert({ level: 12, charging: false, alertActive: true, lowSent: false, finalSent: false }),
    null
  );
});

test("decide: 5% with NO active alert is a low warning, not a final burst", () => {
  assert.equal(
    decideBatteryAlert({ level: 5, charging: false, alertActive: false, lowSent: false, finalSent: false }),
    "low"
  );
});

test("decide: invalid levels never alert", () => {
  for (const level of [NaN, -1, 101, "15", undefined]) {
    assert.equal(
      decideBatteryAlert({ level, charging: false, alertActive: false, lowSent: false, finalSent: false }),
      null
    );
  }
});

test("band check: low accepts 0–15, final accepts 0–5, nothing else", () => {
  assert.equal(isBatteryLevelInBand("low", 15), true);
  assert.equal(isBatteryLevelInBand("low", 16), false);
  assert.equal(isBatteryLevelInBand("final", 5), true);
  assert.equal(isBatteryLevelInBand("final", 6), false);
  assert.equal(isBatteryLevelInBand("low", -1), false);
  assert.equal(isBatteryLevelInBand("bogus", 5), false);
});

test("low message: warning wording, last location, never claims danger", () => {
  const msg = buildBatteryMessage({
    kind: "low",
    name: "Test User",
    phone: "9999999999",
    battery: 15,
    lat: 28.6139,
    lng: 77.209,
    contacts: [{ name: "Mom", phone: "8888888888" }],
    when: new Date("2026-11-03T08:00:00Z"),
  });
  assert.ok(msg.includes("LOW BATTERY"));
  assert.ok(msg.includes("15%"));
  assert.ok(msg.includes("https://maps.google.com/?q=28.6139,77.209"));
  assert.ok(msg.includes("Mom — 8888888888"));
  assert.ok(!msg.includes("I AM IN DANGER"));
  assert.ok(!msg.includes("EMERGENCY SOS"));
});

test("final message: SOS-active + may-die wording, live-page link when given", () => {
  const msg = buildBatteryMessage({
    kind: "final",
    name: "Test User",
    phone: "9999999999",
    battery: 5,
    lat: 28.6139,
    lng: 77.209,
    viewUrl: "https://example.invalid/alert/abc/view?token=tok",
    when: new Date("2026-11-03T08:00:00Z"),
  });
  assert.ok(msg.includes("FINAL LOCATION"));
  assert.ok(msg.includes("5%"));
  assert.ok(msg.includes("https://example.invalid/alert/abc/view?token=tok"));
  const noLink = buildBatteryMessage({ kind: "final", battery: 5, lat: 0, lng: 0 });
  assert.ok(!noLink.includes("LIVE ALERT PAGE"));
});
