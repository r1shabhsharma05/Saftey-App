// SafeLife 2.0 Day 16 — journey share-token tests (plan §6 D16).
// Same HMAC pattern as services/alertView.js (D9): per-journey
// capability keyed by API_SECRET, timing-safe verify, no new secret.
const test = require("node:test");
const assert = require("node:assert/strict");

const { journeyToken, verifyJourneyToken } = require("../services/journeyView");

const OLD_SECRET = process.env.API_SECRET;

test("journeyToken: mints a hex token and verifies it back", () => {
  process.env.API_SECRET = "d16-test-secret";
  const token = journeyToken("journey-123");
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(verifyJourneyToken("journey-123", token), true);
});

test("verifyJourneyToken: wrong journey, wrong token, or tampered token fails", () => {
  process.env.API_SECRET = "d16-test-secret";
  const token = journeyToken("journey-123");
  assert.equal(verifyJourneyToken("journey-456", token), false);
  assert.equal(verifyJourneyToken("journey-123", "0".repeat(64)), false);
  assert.equal(verifyJourneyToken("journey-123", token.slice(0, -1) + "0"), false);
  assert.equal(verifyJourneyToken("journey-123", ""), false);
  assert.equal(verifyJourneyToken("journey-123", undefined), false);
});

test("journeyToken: no secret means no token and no verification", () => {
  delete process.env.API_SECRET;
  assert.equal(journeyToken("journey-123"), null);
  assert.equal(verifyJourneyToken("journey-123", "a".repeat(64)), false);
  if (OLD_SECRET === undefined) delete process.env.API_SECRET;
  else process.env.API_SECRET = OLD_SECRET;
});
