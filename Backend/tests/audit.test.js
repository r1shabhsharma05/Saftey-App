// Unit tests for services/audit.js — the D1 admin-action audit trail.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { audit, fingerprint, _setWriteSink } = require("../services/audit");

test("fingerprint is stable, one-way, and never the key", () => {
  const a = fingerprint("secret-key-123");
  assert.equal(a, fingerprint("secret-key-123"));
  assert.notEqual(a, fingerprint("other-key"));
  assert.ok(!a.includes("secret-key-123"));
  assert.equal(a.length, 16);
  assert.equal(fingerprint(""), "none");
  assert.equal(fingerprint(undefined), "none");
});

test("audit line carries action + fingerprint, never the key or PII", () => {
  const lines = [];
  _setWriteSink((l) => lines.push(l));
  try {
    audit("api_key.rejected", {
      actorKey: "super-secret-key",
      ip: "1.2.3.4",
      meta: { sent: 0, failed: 1 },
    });
  } finally {
    _setWriteSink((l) => process.stdout.write(l + "\n"));
  }
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.audit, true);
  assert.equal(entry.action, "api_key.rejected");
  assert.equal(entry.actor, fingerprint("super-secret-key"));
  assert.equal(entry.ip, "1.2.3.4");
  assert.deepEqual(entry.meta, { sent: 0, failed: 1 });
  assert.ok(!lines[0].includes("super-secret-key"), "raw key leaked into audit line");
  assert.ok(entry.ts);
});

test("audit never throws, even with a broken sink", () => {
  _setWriteSink(() => {
    throw new Error("sink down");
  });
  try {
    assert.doesNotThrow(() => audit("alert.dispatched", { meta: { sent: 1 } }));
  } finally {
    _setWriteSink((l) => process.stdout.write(l + "\n"));
  }
});

test("when Supabase is configured, audit mirrors the line to audit_events", async () => {
  const { _setDbTransport } = require("../services/supabaseDb");
  const OLD_URL = process.env.SUPABASE_URL;
  const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const calls = [];
  _setDbTransport(async (call) => {
    calls.push(call);
    return { data: null };
  });
  const lines = [];
  _setWriteSink((l) => lines.push(l));
  try {
    audit("alert.delivered", {
      actorKey: "k",
      ip: "1.2.3.4",
      meta: { alertId: "alert-1", sent: 1, failed: 0 },
    });
    // Fire-and-forget mirror: let the microtask run before asserting.
    await new Promise((r) => setImmediate(r));
    assert.equal(lines.length, 1);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/rest/v1/audit_events"));
    assert.ok(!calls[0].url.includes("on_conflict"), "identity-PK table must be a plain insert");
    assert.equal(calls[0].body.action, "alert.delivered");
    assert.equal(calls[0].body.alert_id, "alert-1");
    assert.equal(calls[0].body.meta.alertId, "alert-1");
  } finally {
    _setDbTransport(null);
    _setWriteSink((l) => process.stdout.write(l + "\n"));
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    else delete process.env.SUPABASE_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
