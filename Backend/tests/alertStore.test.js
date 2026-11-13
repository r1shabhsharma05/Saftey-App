// Unit tests for services/alertStore.js — in-memory alert store with
// Postgres persistence when Supabase is configured (D3).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAlert, transition } = require("../services/alertLifecycle");
const { save, get, toPublic, findAlertsForGuardian, _clearMemory, _size, _has } = require("../services/alertStore");
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
    "acks",
    "contacts",
    "createdAt",
    "delivery",
    "escalation",
    "failed",
    "guardians",
    "id",
    "lat",
    "lng",
    "locationAt",
    "retry",
    "sent",
    "state",
    "updatedAt",
  ]);
  assert.ok(!("history" in pub));
  assert.equal(pub.lat, null);
  assert.equal(pub.locationAt, null);
});

test("toPublic carries the live position once set", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    _clearMemory();
    const alert = createAlert({ contactsCount: 1, lat: 28.6139, lng: 77.209 });
    await save(alert);
    const pub = toPublic(await get(alert.id));
    assert.equal(pub.lat, 28.6139);
    assert.equal(pub.lng, 77.209);
    assert.equal(pub.locationAt, alert.createdAt);
  } finally {
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  }
});

test("save: caps memory at 500 alerts, evicting the oldest finished first (M1)", () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    _clearMemory();
    const closed = createAlert({ contactsCount: 0 });
    transition(closed, "dispatching");
    transition(closed, "delivered");
    transition(closed, "acked");
    transition(closed, "closed");
    save(closed);
    const firstLive = createAlert({ contactsCount: 0 });
    transition(firstLive, "dispatching");
    transition(firstLive, "delivered");
    save(firstLive);
    // 2 + 499 = 501 → one eviction: the closed alert goes first.
    for (let i = 0; i < 499; i++) save(createAlert({ contactsCount: 0 }));
    assert.equal(_size(), 500);
    assert.equal(_has(closed.id), false);
    assert.equal(_has(firstLive.id), true);
    // One more: no finished alert left, so the oldest live one goes —
    // the cap holds, and an SOS is never refused for capacity.
    save(createAlert({ contactsCount: 0 }));
    assert.equal(_size(), 500);
    assert.equal(_has(firstLive.id), false);
  } finally {
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  }
});

test("toPublic carries the guardian summary once set, null before (D21)", () => {
  const alert = createAlert({ contactsCount: 1 });
  assert.equal(toPublic(alert).guardians, null);
  const { newGuardianAlertState, recordNotification } = require("../services/guardianAlert");
  alert.guardians = newGuardianAlertState();
  recordNotification(alert.guardians, {
    guardianId: "g1",
    name: "Asha",
    role: "family",
    distanceKm: 0.4,
    score: 0.8,
    nowMs: Date.now(),
  });
  const pub = toPublic(alert);
  assert.equal(pub.guardians.notified, 1);
  assert.equal(pub.guardians.accepted, 0);
  assert.equal(pub.guardians.responses[0].guardianId, "g1");
});

test("findAlertsForGuardian: live alerts for this guardian only (D21)", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { newGuardianAlertState, recordNotification } = require("../services/guardianAlert");
  try {
    _clearMemory();
    const live = createAlert({ contactsCount: 1 });
    live.guardians = newGuardianAlertState();
    recordNotification(live.guardians, { guardianId: "g1", name: "Asha", role: "family", distanceKm: 0.4, score: 0.8, nowMs: Date.now() });
    transition(live, "dispatching");
    transition(live, "delivered");
    save(live);
    const other = createAlert({ contactsCount: 1 });
    other.guardians = newGuardianAlertState();
    recordNotification(other.guardians, { guardianId: "g2", name: "Ravi", role: "security", distanceKm: 0.9, score: 0.5, nowMs: Date.now() });
    transition(other, "dispatching");
    transition(other, "delivered");
    save(other);
    const closed = createAlert({ contactsCount: 1 });
    closed.guardians = newGuardianAlertState();
    recordNotification(closed.guardians, { guardianId: "g1", name: "Asha", role: "family", distanceKm: 0.4, score: 0.8, nowMs: Date.now() });
    transition(closed, "dispatching");
    transition(closed, "delivered");
    transition(closed, "acked");
    transition(closed, "closed");
    save(closed);
    const plain = createAlert({ contactsCount: 1 });
    transition(plain, "dispatching");
    transition(plain, "delivered");
    save(plain);
    // A failed alert is still live for its guardians: its contacts
    // never got the SOS, so the guardians may be the only rescue path.
    const failed = createAlert({ contactsCount: 1 });
    failed.guardians = newGuardianAlertState();
    recordNotification(failed.guardians, { guardianId: "g1", name: "Asha", role: "family", distanceKm: 0.4, score: 0.8, nowMs: Date.now() });
    transition(failed, "dispatching");
    transition(failed, "failed");
    save(failed);
    const found = findAlertsForGuardian("g1");
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((a) => a.id).sort(), [live.id, failed.id].sort());
    assert.equal(findAlertsForGuardian("g2").length, 1);
    assert.equal(findAlertsForGuardian("ghost").length, 0);
  } finally {
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    else delete process.env.SUPABASE_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("when configured, the guardians blob rides the Postgres mirror and back (D21)", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const calls = [];
  _setDbTransport(async (call) => {
    calls.push(call);
    if (call.method === "GET") {
      return {
        data: [{
          id: "db-guardians",
          state: "delivered",
          sent: 1,
          failed: 0,
          contacts_count: 1,
          created_at: "2026-11-13T00:00:00.000Z",
          updated_at: "2026-11-13T00:01:00.000Z",
          guardians: { responses: { g1: { state: "accepted" } }, locations: {}, messages: [] },
        }],
      };
    }
    return { data: null };
  });
  const { newGuardianAlertState, recordNotification } = require("../services/guardianAlert");
  try {
    _clearMemory();
    const alert = createAlert();
    alert.id = "db-guardians";
    alert.guardians = newGuardianAlertState();
    recordNotification(alert.guardians, { guardianId: "g1", name: "Asha", role: "family", distanceKm: 0.4, score: 0.8, nowMs: Date.now() });
    await save(alert);
    const upsert = calls.find((c) => c.method === "POST");
    assert.ok(upsert);
    assert.equal(upsert.body.guardians.responses.g1.state, "notified");
    _clearMemory();
    const found = await get("db-guardians");
    assert.equal(found.guardians.responses.g1.state, "accepted");
    // A row predating D21 carries no guardians column — reads as null, never crashes.
    _setDbTransport(async () => ({ data: [{ id: "db-old", state: "delivered", sent: 1, failed: 0, contacts_count: 0, created_at: "2026-10-26T00:00:00.000Z", updated_at: "2026-10-26T00:01:00.000Z" }] }));
    _clearMemory();
    assert.equal((await get("db-old")).guardians, null);
  } finally {
    _setDbTransport(null);
    if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
    else delete process.env.SUPABASE_URL;
    if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
