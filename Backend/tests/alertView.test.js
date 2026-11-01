// Unit tests for services/alertView.js — per-alert view tokens (D9).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { viewToken, verifyViewToken } = require("../services/alertView");

test("viewToken: deterministic, verifies, rejects tampered id and token", () => {
  const prev = process.env.API_SECRET;
  process.env.API_SECRET = "d9-view-secret";
  try {
    const token = viewToken("alert-1");
    assert.ok(token);
    assert.equal(token, viewToken("alert-1"), "same alert + secret = same token");
    assert.ok(verifyViewToken("alert-1", token));
    assert.ok(!verifyViewToken("alert-2", token), "token is bound to one alert");
    assert.ok(!verifyViewToken("alert-1", "0".repeat(token.length)));
    assert.ok(!verifyViewToken("alert-1", undefined));
    assert.ok(!verifyViewToken("alert-1", ""));
  } finally {
    if (prev === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = prev;
  }
});

test("viewToken differs from the retry token for the same alert", () => {
  const prev = process.env.API_SECRET;
  process.env.API_SECRET = "d9-view-secret";
  try {
    const { retryToken } = require("../services/delivery");
    assert.notEqual(viewToken("alert-1"), retryToken("alert-1", 1));
  } finally {
    if (prev === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = prev;
  }
});

test("no signing secret → null token, verify always false", () => {
  const prev = process.env.API_SECRET;
  delete process.env.API_SECRET;
  try {
    assert.equal(viewToken("alert-1"), null);
    assert.equal(viewToken(""), null);
    assert.equal(verifyViewToken("alert-1", "anything"), false);
  } finally {
    if (prev !== undefined) process.env.API_SECRET = prev;
  }
});
