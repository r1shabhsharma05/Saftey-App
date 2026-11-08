// SafeLife 2.0 Day 16 — journey store tests (plan §6 D16).
// Mirrors services/alertStore.js (D3): in-memory Map is the fast
// path, Postgres (when configured) the shared truth, writes
// fire-and-forget. One deliberate difference: the store is BOUNDED
// (500 journeys) — an unauthenticated create loop must not grow
// server memory without limit; the oldest finished journey is
// evicted first, and only then the oldest active one.
const test = require("node:test");
const assert = require("node:assert/strict");

const { createJourney, transition } = require("../services/journey");
const journeyStore = require("../services/journeyStore");
const { _setDbTransport, dbStatus } = require("../services/supabaseDb");

const NOW = Date.now();
const inMinutes = (m) => new Date(NOW + m * 60 * 1000).toISOString();

const makeJourney = (label = "Connaught Place") =>
  createJourney({
    originLat: 28.6139,
    originLng: 77.209,
    destLat: 28.62,
    destLng: 77.215,
    destinationLabel: label,
    expectedArrivalAt: inMinutes(25),
    userName: "Rishabh Sharma",
  });

test("save + get: round-trips a journey from memory", async () => {
  journeyStore._clearMemory();
  const j = makeJourney();
  journeyStore.save(j);
  const found = await journeyStore.get(j.id);
  assert.equal(found.id, j.id);
  assert.equal(found.state, "active");
  assert.equal(found.destination.label, "Connaught Place");
});

test("get: unknown id is null (no Postgres configured in tests)", async () => {
  journeyStore._clearMemory();
  assert.equal(dbStatus().configured, false);
  assert.equal(await journeyStore.get("00000000-0000-0000-0000-000000000000"), null);
});

test("save: mirrors to Postgres when configured (fire-and-forget upsert)", async () => {
  journeyStore._clearMemory();
  const calls = [];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  _setDbTransport(async (call) => {
    calls.push(call);
    return { data: [] };
  });
  try {
    const j = makeJourney();
    const p = journeyStore.save(j);
    assert.ok(p && typeof p.then === "function");
    await p;
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/journeys\?on_conflict=id$/);
    assert.equal(calls[0].body.id, j.id);
    assert.equal(calls[0].body.state, "active");
    assert.equal(calls[0].body.destination_label, "Connaught Place");
    assert.equal(calls[0].body.user_name, "Rishabh Sharma");
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _setDbTransport(null);
  }
});

test("get: falls back to Postgres when memory misses", async () => {
  journeyStore._clearMemory();
  const j = makeJourney();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  _setDbTransport(async () => ({
    data: [
      {
        id: j.id,
        state: "arrived",
        user_name: "Rishabh Sharma",
        origin_lat: 28.6139,
        origin_lng: 77.209,
        dest_lat: 28.62,
        dest_lng: 77.215,
        destination_label: "Connaught Place",
        expected_arrival_at: j.expectedArrivalAt,
        last_lat: 28.615,
        last_lng: 77.211,
        location_at: j.locationAt,
        created_at: j.createdAt,
        updated_at: j.updatedAt,
      },
    ],
  }));
  try {
    const found = await journeyStore.get(j.id);
    assert.equal(found.state, "arrived");
    assert.equal(found.lat, 28.615);
    assert.equal(found.destination.label, "Connaught Place");
    assert.deepEqual(found.history, []);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _setDbTransport(null);
  }
});

test("save: caps memory at 500 journeys, evicting the oldest finished first", () => {
  journeyStore._clearMemory();
  const finished = makeJourney("Finished");
  transition(finished, "arrived");
  journeyStore.save(finished);
  const firstActive = makeJourney("First active");
  journeyStore.save(firstActive);
  // 2 + 499 = 501 → one eviction: the finished journey goes first.
  for (let i = 0; i < 499; i++) journeyStore.save(makeJourney(`J${i}`));
  assert.equal(journeyStore._size(), 500);
  assert.equal(journeyStore._has(finished.id), false);
  assert.equal(journeyStore._has(firstActive.id), true);
  // One more active journey: no finished journey is left to evict,
  // so the oldest active one goes — the cap holds either way.
  journeyStore.save(makeJourney("One more"));
  assert.equal(journeyStore._size(), 500);
  assert.equal(journeyStore._has(firstActive.id), false);
});

test("toPublic: the store's public shape matches the service shape", () => {
  const j = makeJourney();
  assert.deepEqual(journeyStore.toPublic(j), require("../services/journey").toPublic(j));
});
