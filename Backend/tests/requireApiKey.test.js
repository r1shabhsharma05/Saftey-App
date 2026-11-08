// Unit tests for middleware/requireApiKey.js — the API-key gate must fail
// CLOSED: an unset API_SECRET refuses mutating requests (503) instead of
// letting them through unauthenticated (audit finding: fail-open gate).
const { test } = require("node:test");
const assert = require("node:assert/strict");

const requireApiKey = require("../middleware/requireApiKey");

const mockReq = (key) => ({
  header: (name) => (name === "x-api-key" ? key || "" : ""),
  ip: "127.0.0.1",
});
const mockRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return { json: (body) => { res.body = body; } };
  };
  return res;
};

test("unset API_SECRET → 503, never next()", () => {
  const prev = process.env.API_SECRET;
  delete process.env.API_SECRET;
  try {
    const req = mockReq("");
    const res = mockRes();
    let nextCalled = false;
    requireApiKey(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.success, false);
  } finally {
    if (prev !== undefined) process.env.API_SECRET = prev;
  }
});

test("set secret: wrong key → 401, right key → next()", () => {
  const prev = process.env.API_SECRET;
  process.env.API_SECRET = "u1-test-secret";
  try {
    const badRes = mockRes();
    let nextCalled = false;
    requireApiKey(mockReq("wrong"), badRes, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(badRes.statusCode, 401);

    const okRes = mockRes();
    requireApiKey(mockReq("u1-test-secret"), okRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(okRes.statusCode, null);
  } finally {
    if (prev === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = prev;
  }
});
