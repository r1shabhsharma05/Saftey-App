// Unit tests for services/alertView.js — per-alert view tokens.
// Tokens carry their expiry (expiry.HMAC) and lapse after 24 h by
// default; a stale or forged token must never open a live location.
process.env.API_SECRET = "d9-test-secret";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { viewToken, verifyViewToken, VIEW_TOKEN_TTL_MS } = require("../services/alertView");

test("minting is deterministic for a given expiry, and verifies", () => {
  const exp = Date.now() + VIEW_TOKEN_TTL_MS;
  const token = viewToken("alert-1", exp);
  assert.equal(token, viewToken("alert-1", exp));
  assert.match(token, /^\d+\.[0-9a-f]{64}$/);
  assert.equal(verifyViewToken("alert-1", token), true);
});

test("default minting verifies and expires after 24 h", () => {
  const token = viewToken("alert-1");
  assert.equal(verifyViewToken("alert-1", token), true);
  assert.ok(Number(token.split(".")[0]) - Date.now() > VIEW_TOKEN_TTL_MS - 1000);
});

test("expired token is rejected", () => {
  const token = viewToken("alert-1", Date.now() - 1000);
  assert.equal(verifyViewToken("alert-1", token), false);
});

test("tampered expiry or wrong alert is rejected", () => {
  const token = viewToken("alert-1", Date.now() + VIEW_TOKEN_TTL_MS);
  const tampered = `${Date.now() + 2 * VIEW_TOKEN_TTL_MS}.${token.split(".")[1]}`;
  assert.equal(verifyViewToken("alert-1", tampered), false);
  assert.equal(verifyViewToken("alert-2", token), false);
});

test("viewToken differs from the retry token for the same alert", () => {
  const { retryToken } = require("../services/delivery");
  assert.notEqual(viewToken("alert-1"), retryToken("alert-1", 1));
});

test("no API_SECRET → null token, verify always false", () => {
  const prev = process.env.API_SECRET;
  delete process.env.API_SECRET;
  try {
    assert.equal(viewToken("alert-1"), null);
    assert.equal(viewToken(""), null);
    assert.equal(verifyViewToken("alert-1", "123.abc"), false);
  } finally {
    process.env.API_SECRET = prev;
  }
});

test("malformed tokens are rejected", () => {
  for (const bad of [undefined, null, "", "not-a-token", "abc.def", `99999999999999999999.${"0".repeat(64)}`]) {
    assert.equal(verifyViewToken("alert-1", bad), false);
  }
});
