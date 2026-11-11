// 🛡️ Guardian onboarding — pure service tests (SafeLife 2.0 Day 19,
// plan §6 D19, plan §3 F2).
//
// No I/O, no timers, no SMS. Time is injected (nowMs) so expiry and
// the per-hour code cap never race the clock. The verification code
// is returned by issueCode to the CALLER only (the route hands it to
// the SMS adapter) — these tests use the returned code the same way
// the route does; no test ever asserts a code travels in a response.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GUARDIAN_ROLES,
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_HOUR,
  createGuardian,
  issueCode,
  verifyCode,
  setAvailable,
  toPublic,
} = require("../services/guardian");

const NOW = Date.parse("2026-11-11T08:00:00.000Z");

const makeGuardian = (overrides = {}) =>
  createGuardian({
    userId: "user-123",
    name: "  Ramesh Kumar  ",
    phone: "+91 98765 43210",
    role: "family",
    ...overrides,
  });

test("createGuardian: valid input → pending, unavailable, phone normalized, name trimmed", () => {
  const g = makeGuardian();
  assert.equal(g.state, "pending");
  assert.equal(g.available, false);
  assert.equal(g.verifiedAt, null);
  assert.equal(g.verification, null);
  assert.equal(g.phone, "+919876543210");
  assert.equal(g.name, "Ramesh Kumar");
  assert.equal(g.role, "family");
  assert.match(g.id, /^[0-9a-f-]{36}$/);
  assert.equal(g.userId, "user-123");
});

test("createGuardian: every role in GUARDIAN_ROLES is accepted", () => {
  for (const role of GUARDIAN_ROLES) {
    assert.equal(makeGuardian({ role }).role, role);
  }
  assert.deepEqual([...GUARDIAN_ROLES].sort(), ["family", "friend", "security", "volunteer"]);
});

test("createGuardian: garbage phone throws; too-short phone throws", () => {
  assert.throws(() => makeGuardian({ phone: "not-a-phone" }), /Invalid phone number/);
  assert.throws(() => makeGuardian({ phone: "12345" }), /Invalid phone number/);
  assert.throws(() => makeGuardian({ phone: "" }), /Invalid phone number/);
});

test("createGuardian: unknown role throws; empty name throws; empty userId throws", () => {
  assert.throws(() => makeGuardian({ role: "police" }), /Invalid guardian role/);
  assert.throws(() => makeGuardian({ name: "   " }), /Invalid guardian name/);
  assert.throws(() => makeGuardian({ userId: "" }), /Invalid guardian user/);
  assert.throws(() => makeGuardian({ userId: "x".repeat(129) }), /Invalid guardian user/);
});

test("issueCode: returns a 6-digit code; stores salted hash (never the code), 10-min expiry, 0 attempts", () => {
  const g = makeGuardian();
  const { code } = issueCode(g, { nowMs: NOW });
  assert.match(code, /^\d{6}$/);
  assert.equal(g.verification.attempts, 0);
  assert.equal(g.verification.expiresAt, new Date(NOW + CODE_TTL_MS).toISOString());
  assert.match(g.verification.hash, /^[0-9a-f]{64}$/);
  assert.equal(g.verification.hash.includes(code), false);
  assert.match(g.verification.salt, /^[0-9a-f]{32}$/);
  assert.equal(CODE_TTL_MS, 10 * 60 * 1000);
});

test("issueCode: 4th code within an hour throws; after 61 minutes it is allowed again", () => {
  const g = makeGuardian();
  for (let i = 0; i < MAX_CODES_PER_HOUR; i++) issueCode(g, { nowMs: NOW + i * 1000 });
  assert.throws(() => issueCode(g, { nowMs: NOW + 4000 }), /Too many verification codes/);
  const again = issueCode(g, { nowMs: NOW + 61 * 60 * 1000 });
  assert.match(again.code, /^\d{6}$/);
});

test("verifyCode: the issued code verifies → verified, verifiedAt set, code cleared", () => {
  const g = makeGuardian();
  const { code } = issueCode(g, { nowMs: NOW });
  verifyCode(g, code, { nowMs: NOW + 60 * 1000 });
  assert.equal(g.state, "verified");
  assert.equal(g.verifiedAt, new Date(NOW + 60 * 1000).toISOString());
  assert.equal(g.verification, null);
});

test("verifyCode: wrong code throws and counts attempts; 5th wrong kills the code", () => {
  // Literal 5, not the imported constant: the constant IS the behaviour
  // under test — a test that reads it from the service cannot catch
  // someone silently raising the limit.
  assert.equal(MAX_CODE_ATTEMPTS, 5);
  assert.equal(MAX_CODES_PER_HOUR, 3);
  const g = makeGuardian();
  const { code } = issueCode(g, { nowMs: NOW });
  const wrong = code === "000000" ? "000001" : "000000";
  for (let i = 1; i <= 4; i++) {
    assert.throws(() => verifyCode(g, wrong, { nowMs: NOW }), /Invalid verification code/);
    assert.equal(g.verification.attempts, i);
  }
  assert.throws(() => verifyCode(g, wrong, { nowMs: NOW }), /Too many attempts/);
  assert.equal(g.verification, null);
  // The real code no longer works either — the code is dead.
  assert.throws(() => verifyCode(g, code, { nowMs: NOW }), /No verification code pending/);
});

test("verifyCode: expired code throws and clears; no code pending throws", () => {
  const g = makeGuardian();
  const { code } = issueCode(g, { nowMs: NOW });
  assert.throws(
    () => verifyCode(g, code, { nowMs: NOW + CODE_TTL_MS + 1000 }),
    /Verification code expired/
  );
  assert.equal(g.verification, null);
  assert.throws(() => verifyCode(makeGuardian(), "123456", { nowMs: NOW }), /No verification code pending/);
});

test("setAvailable: pending guardian cannot go available; verified can toggle both ways; non-boolean throws", () => {
  const g = makeGuardian();
  assert.throws(() => setAvailable(g, true), /must be verified/);
  const { code } = issueCode(g, { nowMs: NOW });
  verifyCode(g, code, { nowMs: NOW });
  setAvailable(g, true);
  assert.equal(g.available, true);
  setAvailable(g, false);
  assert.equal(g.available, false);
  assert.throws(() => setAvailable(g, "yes"), /Invalid availability value/);
});

test("toPublic: carries the owner-visible fields and NOTHING secret (no hash, salt, code, attempts)", () => {
  const g = makeGuardian();
  issueCode(g, { nowMs: NOW });
  const pub = toPublic(g);
  assert.equal(pub.id, g.id);
  assert.equal(pub.phone, g.phone);
  assert.equal(pub.state, "pending");
  assert.equal(pub.available, false);
  assert.equal("verification" in pub, false);
  assert.equal("hash" in pub, false);
  assert.equal("salt" in pub, false);
  assert.equal("codeRequests" in pub, false);
  assert.equal(JSON.stringify(pub).includes(g.verification.hash), false);
});
