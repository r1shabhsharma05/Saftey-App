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
