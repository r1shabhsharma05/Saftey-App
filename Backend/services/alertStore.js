// 🗄️ Alert store — in-memory alerts with Postgres persistence (D3).
//
// Serverless reality: one Vercel instance's memory is not shared, so the
// Map is the fast path and Postgres (when configured) is the shared
// truth. save() always writes memory and, when configured, upserts the
// row fire-and-forget — the SOS response must never wait on the DB.
// get() tries memory first, then Postgres; a Postgres row carries no
// transition history (that lives in audit_events via services/audit.js),
// so a DB-backed read returns history: [] — stated here, not hidden.
//
// Row shape (see supabase/migrations/20261026080000_sos_alerts_audit.sql):
// id, state, sent, failed, contacts_count, created_at, updated_at.
const { dbStatus, dbUpsert, dbSelectOne } = require("./supabaseDb");

const memory = new Map();

const toRow = (alert) => ({
  id: alert.id,
  state: alert.state,
  sent: alert.sent,
  failed: alert.failed,
  contacts_count: alert.contacts,
  created_at: alert.createdAt,
  updated_at: alert.updatedAt,
  delivery: alert.delivery || [],
  retry: alert.retry || null,
  // D10 ACKs + escalation runs (migration 20261102080000_alert_escalation.sql).
  // acks are {key, at} hashes only — never raw phones/tokens.
  acks: alert.acks || [],
  escalation: alert.escalation || null,
  // D9 live position (migration 20261101080000_alert_location.sql).
  // Null when the alert predates D9 or carried no fix — the mirror
  // must never invent a position.
  lat: alert.lat ?? null,
  lng: alert.lng ?? null,
  location_at: alert.locationAt ?? null,
  // H3 ACK binding (migration 20261108090000_sos_alerts_ack_binding.sql):
  // one-way hashes of the contacts this SOS went to. Empty for legacy
  // alerts — the lifecycle treats an empty set as unbound.
  contact_keys: alert.contactKeys || [],
  // L5 retry binding (same migration): the exact message + contacts
  // the SOS first went out with, and the retry attempts already used.
  // Null/empty for legacy alerts — the retry/escalate routes fall back
  // to the callback body's copy for those, and only those.
  sos_message: alert.sosMessage ?? null,
  sos_contacts: alert.sosContacts || [],
  retry_consumed: alert.retryConsumed || [],
});

const fromRow = (row) => ({
  id: row.id,
  state: row.state,
  sent: row.sent,
  failed: row.failed,
  contacts: row.contacts_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  history: [],
  delivery: row.delivery || [],
  retry: row.retry || null,
  acks: row.acks || [],
  escalation: row.escalation || null,
  lat: row.lat ?? null,
  lng: row.lng ?? null,
  locationAt: row.location_at ?? null,
  contactKeys: row.contact_keys || [],
  sosMessage: row.sos_message ?? null,
  sosContacts: row.sos_contacts || [],
  retryConsumed: row.retry_consumed || [],
});

// Public shape for GET /alert/:id — no history, no internals. Delivery
// receipts ARE public to the key-holding caller: this is what D5's
// status UI polls, and hiding it would defeat the receipt feature.
// D9: the live position rides along (the key-holding caller is the
// victim's own app; the contacts-side page has its own token-gated
// read path and never sees this shape).
const toPublic = (alert) => ({
  id: alert.id,
  state: alert.state,
  sent: alert.sent,
  failed: alert.failed,
  contacts: alert.contacts,
  createdAt: alert.createdAt,
  updatedAt: alert.updatedAt,
  delivery: alert.delivery || [],
  retry: alert.retry || null,
  // D10: ack hashes + escalation schedule/runs — what D5's status UI
  // polls to show confirmations and ladder progress. Ack keys are
  // hashes, safe to expose to the key-holding caller.
  acks: alert.acks || [],
  escalation: alert.escalation || null,
  lat: alert.lat ?? null,
  lng: alert.lng ?? null,
  locationAt: alert.locationAt ?? null,
});

const save = (alert) => {
  memory.set(alert.id, alert);
  // Fire-and-forget by design: returns the promise so tests can await
  // it, but callers on the request path must not await it.
  if (dbStatus().configured) return dbUpsert("sos_alerts", toRow(alert));
  return undefined;
};

const get = async (id) => {
  if (memory.has(id)) return memory.get(id);
  if (!dbStatus().configured) return null;
  const res = await dbSelectOne("sos_alerts", id);
  return res.ok ? fromRow(res.row) : null;
};

module.exports = {
  save,
  get,
  toPublic,
  // Test seam only.
  _clearMemory: () => memory.clear(),
};
