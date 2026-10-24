// Unit tests for lib/validate.js — the trust boundary for every route.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidLatitude,
  isValidLongitude,
  sanitizeText,
} = require("../lib/validate");

test("rejects garbage coordinates", () => {
  for (const bad of [undefined, null, "", "12abc", NaN, Infinity, 91, -91, true, [], {}]) {
    assert.equal(isValidLatitude(bad), false, `lat ${String(bad)}`);
  }
  assert.equal(isValidLongitude(9999), false);
  assert.equal(isValidLongitude("abc"), false);
});

test("accepts numeric strings at the boundary", () => {
  assert.equal(isValidLatitude("90"), true);
  assert.equal(isValidLatitude("-90"), true);
  assert.equal(isValidLongitude("180"), true);
  assert.equal(isValidLongitude(0), true);
});

test("sanitizeText strips control chars and caps length", () => {
  assert.equal(sanitizeText("ok\x00\x1bname", 100), "okname");
  assert.equal(sanitizeText("  padded  ", 100), "padded");
  assert.equal(sanitizeText("x".repeat(300), 100).length, 100);
  assert.equal(sanitizeText(undefined), "");
  assert.equal(sanitizeText(85, 10), "85"); // numeric battery level
});
