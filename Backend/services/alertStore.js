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
});

// Public shape for GET /alert/:id — no history, no internals.
const toPublic = (alert) => ({
  id: alert.id,
  state: alert.state,
  sent: alert.sent,
  failed: alert.failed,
  contacts: alert.contacts,
  createdAt: alert.createdAt,
  updatedAt: alert.updatedAt,
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
