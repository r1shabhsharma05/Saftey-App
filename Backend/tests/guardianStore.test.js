// 🛡️ Guardian store tests — SafeLife 2.0 Day 19 (plan §6 D19).
// Same shape as services/journeyStore.js (D16): in-memory Map is the
// fast path, Postgres (when configured) the shared truth, writes
// fire-and-forget. One deliberate difference: the store is keyed by
// id AND by phone (one guardian per phone — the registration route
// dedupes on it), and it is BOUNDED at 1000: the oldest *pending*
// guardian is evicted first, a verified guardian is NEVER evicted —
// dropping one would strand a rescuer mid-availability. When the
// store is full of verified guardians, save() refuses (false) and
// the register route answers 503.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createGuardian, issueCode, verifyCode } = require("../services/guardian");
const guardianStore = require("../services/guardianStore");
const { _setDbTransport, dbStatus } = require("../services/supabaseDb");

const NOW = Date.parse("2026-11-11T08:00:00.000Z");

const makeGuardian = (phoneSuffix = "0", overrides = {}) =>
  createGuardian({
    userId: `user-${phoneSuffix}`,
    name: "Test Guardian",
    phone: `+91987654321${phoneSuffix}`,
    role: "family",
    ...overrides,
  });

// Phones must be distinct per guardian in the fill loops: suffix
// varies the last digit (10–15 digits stays valid).
const makeDistinct = (i) =>
  createGuardian({
    userId: `user-${i}`,
    name: "Fill Guardian",
    phone: `+9198765${String(10000 + i).padStart(5, "0")}`,
    role: "friend",
  });

test("save + get: round-trips a guardian from memory", async () => {
  guardianStore._clearMemory();
  const g = makeGuardian();
  guardianStore.save(g);
  const found = await guardianStore.get(g.id);
  assert.equal(found.id, g.id);
  assert.equal(found.state, "pending");
  assert.equal(found.phone, g.phone);
});

test("get: unknown id is null (no Postgres configured in tests)", async () => {
  guardianStore._clearMemory();
  assert.equal(dbStatus().configured, false);
  assert.equal(await guardianStore.get("00000000-0000-0000-0000-000000000000"), null);
});

test("getByPhone: finds by normalized phone; unknown phone is null", async () => {
  guardianStore._clearMemory();
  const g = makeGuardian();
  guardianStore.save(g);
  assert.equal((await guardianStore.getByPhone("+91 98765 43210")).id, g.id);
  assert.equal(await guardianStore.getByPhone("+919999999999"), null);
});

test("save: mirrors to Postgres when configured — code hash IS mirrored, request ledger is NOT", async () => {
  guardianStore._clearMemory();
  const calls = [];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  _setDbTransport(async (call) => {
    calls.push(call);
    return { data: [] };
  });
  try {
    const g = makeGuardian();
    const { code } = issueCode(g, { nowMs: NOW });
    const p = guardianStore.save(g);
    assert.ok(p && typeof p.then === "function");
    await p;
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/guardians\?on_conflict=id$/);
    assert.equal(calls[0].body.id, g.id);
    assert.equal(calls[0].body.phone, g.phone);
    assert.equal(calls[0].body.code_hash, g.verification.hash);
    assert.equal(calls[0].body.code_salt, g.verification.salt);
    assert.equal(calls[0].body.code_attempts, 0);
    assert.equal("code_requests" in calls[0].body, false);
    assert.equal(JSON.stringify(calls[0].body).includes(code), false);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _setDbTransport(null);
  }
});

test("get + getByPhone: fall back to Postgres when memory misses", async () => {
  guardianStore._clearMemory();
  const g = makeGuardian();
  const { code } = issueCode(g, { nowMs: NOW });
  verifyCode(g, code, { nowMs: NOW + 60 * 1000 });
  const row = {
    id: g.id,
    user_id: g.userId,
    name: g.name,
    phone: g.phone,
    role: g.role,
    state: "verified",
    available: true,
    verified_at: g.verifiedAt,
    code_hash: null,
    code_salt: null,
    code_expires_at: null,
    code_attempts: 0,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
  };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const urls = [];
  _setDbTransport(async (call) => {
    urls.push(call.url);
    return { data: [row] };
  });
  try {
    const byId = await guardianStore.get(g.id);
    assert.equal(byId.state, "verified");
    assert.equal(byId.available, true);
    assert.equal(byId.verification, null);
    assert.deepEqual(byId.codeRequests, []);
    const byPhone = await guardianStore.getByPhone(g.phone);
    assert.equal(byPhone.id, g.id);
    assert.ok(urls.some((u) => u.includes("phone=eq.")));
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _setDbTransport(null);
  }
});

test("save: caps memory at 1000 guardians, evicting the oldest pending first — verified never evicted", () => {
  guardianStore._clearMemory();
  const verified = makeGuardian("1");
  const { code } = issueCode(verified, { nowMs: NOW });
  verifyCode(verified, code, { nowMs: NOW });
  guardianStore.save(verified);
  const firstPending = makeDistinct(0);
  guardianStore.save(firstPending);
  for (let i = 1; i < 999; i++) guardianStore.save(makeDistinct(i));
  assert.equal(guardianStore._size(), 1000);
  // One more pending guardian: the oldest pending goes, the verified one stays.
  const extra = makeDistinct(999);
  guardianStore.save(extra);
  assert.equal(guardianStore._size(), 1000);
  assert.equal(guardianStore._has(firstPending.id), false);
  assert.equal(guardianStore._has(verified.id), true);
  assert.equal(guardianStore._has(extra.id), true);
});

test("save: refuses (false) when the store is full of verified guardians", () => {
  guardianStore._clearMemory();
  for (let i = 0; i < 1000; i++) {
    const g = makeDistinct(i);
    const { code } = issueCode(g, { nowMs: NOW });
    verifyCode(g, code, { nowMs: NOW });
    guardianStore.save(g);
  }
  assert.equal(guardianStore._size(), 1000);
  assert.equal(guardianStore.save(makeDistinct(1000)), false);
  assert.equal(guardianStore._size(), 1000);
});
