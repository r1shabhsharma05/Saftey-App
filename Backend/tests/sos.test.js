// Unit tests for services/sos.js — message composition stays correct
// after the D1 extraction from server.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSosMessage } = require("../services/sos");

test("SOS message embeds location links and fields", () => {
  const msg = buildSosMessage({
    name: "Test User",
    phone: "9999999999",
    battery: "42",
    status: "Moving",
    nearestStation: "Connaught Place PS",
    lat: 28.6139,
    lng: 77.209,
    contacts: [{ name: "Mom", phone: "8888888888" }],
    when: new Date("2026-10-24T08:00:00Z"),
  });
  assert.ok(msg.includes("https://maps.google.com/?q=28.6139,77.209"));
  assert.ok(msg.includes("Test User"));
  assert.ok(msg.includes("42%"));
  assert.ok(msg.includes("Connaught Place PS"));
  assert.ok(msg.includes("Mom — 8888888888"));
});

test("SOS message works with no contacts and defaults", () => {
  const msg = buildSosMessage({ lat: 0, lng: 0 });
  assert.ok(!msg.includes("Emergency contacts"));
  assert.ok(msg.includes("Unknown User"));
  assert.ok(msg.includes("https://maps.google.com/?q=0,0"));
});
