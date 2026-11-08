// 🗄️ Journey store — in-memory journeys with Postgres persistence (D16).
//
// Same shape as services/alertStore.js (D3): one Vercel instance's
// memory is not shared, so the Map is the fast path and Postgres
// (when configured) is the shared truth. save() always writes memory
// and, when configured, upserts the row fire-and-forget — a journey
// create must never wait on the DB. get() tries memory first, then
// Postgres; a Postgres row carries no transition history (that lives
// in audit_events via services/audit.js), so a DB-backed read returns
// history: [] — stated here, not hidden.
//
// One deliberate difference from alertStore: the store is BOUNDED
// (500 journeys). A journey create is a cheap unauthenticated-shape
// write behind a 60/min bucket, and an unbounded Map on a serverless
// instance is a memory DoS; eviction takes the oldest finished
// journey (its trip is over — nobody is watching it). A live journey
// is NEVER evicted (M7): dropping one would strand a trip whose
// contacts are watching it. When the store is full of live journeys,
// save() refuses (returns false) and the create route answers 503 —
// the traveller retries, instead of a stranger's trip disappearing.
//
// Row shape (see supabase/migrations/20261108080000_journeys.sql):
// id, state, user_name, origin_lat/lng, dest_lat/lng,
// destination_label, expected_arrival_at, last_lat/lng, location_at,
// created_at, updated_at.
const { dbStatus, dbUpsert, dbSelectOne } = require("./supabaseDb");
const { toPublic, toView } = require("./journey");

const MAX_JOURNEYS = 500;

const memory = new Map();

const toRow = (journey) => ({
  id: journey.id,
  state: journey.state,
  user_name: journey.userName || "",
  origin_lat: journey.origin.lat,
  origin_lng: journey.origin.lng,
  dest_lat: journey.destination.lat,
  dest_lng: journey.destination.lng,
  destination_label: journey.destination.label,
  expected_arrival_at: journey.expectedArrivalAt,
  last_lat: journey.lat ?? null,
  last_lng: journey.lng ?? null,
  location_at: journey.locationAt ?? null,
  created_at: journey.createdAt,
  updated_at: journey.updatedAt,
});

const fromRow = (row) => ({
  id: row.id,
  state: row.state,
  userName: row.user_name || "",
  origin: { lat: row.origin_lat, lng: row.origin_lng },
  destination: { lat: row.dest_lat, lng: row.dest_lng, label: row.destination_label },
  expectedArrivalAt: row.expected_arrival_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  history: [],
  lat: row.last_lat ?? null,
  lng: row.last_lng ?? null,
  locationAt: row.location_at ?? null,
});

const save = (journey) => {
  if (!memory.has(journey.id) && memory.size >= MAX_JOURNEYS) {
    // New journey needs a slot: evict finished ones (oldest first).
    // If every journey is live there is no safe victim — refuse
    // (false) instead of stranding a live trip. The caller answers
    // 503; the traveller retries.
    for (const j of [...memory.values()]) {
      if (memory.size < MAX_JOURNEYS) break;
      if (j.state !== "active") memory.delete(j.id);
    }
    if (memory.size >= MAX_JOURNEYS) return false;
  }
  memory.set(journey.id, journey);
  // Fire-and-forget by design: returns the promise so tests can await
  // it, but callers on the request path must not await it.
  if (dbStatus().configured) return dbUpsert("journeys", toRow(journey));
  return undefined;
};

const get = async (id) => {
  if (memory.has(id)) return memory.get(id);
  if (!dbStatus().configured) return null;
  const res = await dbSelectOne("journeys", id);
  return res.ok ? fromRow(res.row) : null;
};

module.exports = {
  save,
  get,
  toPublic,
  toView,
  MAX_JOURNEYS,
  // Test seams only.
  _clearMemory: () => memory.clear(),
  _size: () => memory.size,
  _has: (id) => memory.has(id),
};
