// Unit tests for services/alertStore.js — in-memory alert store with
// Postgres persistence when Supabase is configured (D3).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAlert, transition } = require("../services/alertLifecycle");
const { save, get, toPublic, _clearMemory } = require("../services/alertStore");
const { _setDbTransport } = require("../services/supabaseDb");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

test("save then get round-trips the alert from memory", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    _clearMemory();
    const alert = createAlert({ contactsCount: 2 });
    transition(alert, "dispatching");
    await save(alert);
    const found = await get(alert.id);
    assert.equal(found.state, "dispatching");
    assert.equal(found.contacts, 2);
    assert.equal(found.history.length, 2);
  } finally {
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  }
});

test("get returns null for an unknown id when unconfigured", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    _clearMemory();
    assert.equal(await get("no-such-id"), null);
  } finally {
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  }
});

test("when configured, save upserts the row and get falls back to Postgres", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const calls = [];
  _setDbTransport(async (call) => {
    calls.push(call);
    if (call.method === "GET") return { data: [{ id: "db-id", state: "delivered", sent: 1, failed: 0, contacts_count: 1, created_at: "2026-10-26T00:00:00.000Z", updated_at: "2026-10-26T00:01:00.000Z" }] };
    return { data: null };
  });
  try {
    _clearMemory();
    const alert = createAlert();
    alert.id = "db-id";
    await save(alert);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.includes("/rest/v1/sos_alerts"));
    // Memory was cleared: get must come back from the fake Postgres row.
    _clearMemory();
    const found = await get("db-id");
    assert.equal(found.state, "delivered");
    assert.equal(found.sent, 1);
    assert.deepEqual(found.history, []);
  } finally {
    _setDbTransport(null);
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    else delete process.env.SUPABASE_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("toPublic strips history and internal fields", () => {
  const alert = createAlert({ contactsCount: 1 });
  const pub = toPublic(alert);
  assert.deepEqual(Object.keys(pub).sort(), [
    "contacts",
    "createdAt",
    "delivery",
    "failed",
    "id",
    "retry",
    "sent",
    "state",
    "updatedAt",
  ]);
  assert.ok(!("history" in pub));
});
