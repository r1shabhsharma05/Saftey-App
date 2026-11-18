// 🗄️ Evidence chunk registry — SafeLife 2.0 Day 26 (stealth
// recording, plan §6 D26, §3 F5).
//
// The app uploads each finished 5 s chunk straight to Supabase
// Storage (the backend never sees the bytes — Vercel cannot hold
// them) and registers it here: which chunks exist for an alert, in
// what order, how big. D27's Evidence Vault hash-chains exactly
// this list, and the app reconciles its resume queue against it.
//
// Same serverless caveat as alertStore: memory is the fast path and
// is instance-local until the Supabase mirror lands (no
// `evidence_chunks` table exists yet — D27 owns that migration, so
// there is deliberately no dbUpsert here; a write to a table that
// does not exist would fail silently and pretend to persist).
// A chunk is keyed by alert + kind + index: re-registering the
// same chunk (upload succeeded, register POST lost) returns the
// stored row instead of duplicating — resume is idempotent by
// construction.
//
// D27: the mirror landed (supabase/migrations/
// 20261119080000_evidence_chunks.sql). register() now also upserts
// the row fire-and-forget — the register response must never wait on
// the DB — and list() falls back to Postgres when this instance's
// memory is empty, so the vault can verify chunks another instance
// registered. Same degradation rule as alertStore: the DB helpers
// never throw, and an unconfigured DB is an honest no-op.
const { dbStatus, dbUpsert, dbSelectMany } = require("./supabaseDb");
const MAX_CHUNKS_PER_ALERT = 2000;
const MAX_ALERTS = 500;

// alertId -> Map("<kind>:<index>" -> chunk)
const memory = new Map();

const keyOf = (kind, index) => `${kind}:${index}`;

const toPublic = (chunk) => ({
  kind: chunk.kind,
  index: chunk.index,
  storagePath: chunk.storagePath,
  bytes: chunk.bytes,
  mime: chunk.mime,
  uploadedAt: chunk.uploadedAt,
});

const register = (alertId, { kind, index, storagePath, bytes, mime }) => {
  let perAlert = memory.get(alertId);
  if (!perAlert) {
    if (memory.size >= MAX_ALERTS) {
      // Bounded memory (same rule as alertStore): the oldest alert's
      // registry goes first. Evidence for a live alert is never
      // evicted while a finished one exists — eviction order is
      // insertion order, and live alerts are the newest.
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    perAlert = new Map();
    memory.set(alertId, perAlert);
  }
  const key = keyOf(kind, index);
  const existing = perAlert.get(key);
  if (existing) return { chunk: existing, created: false };
  if (perAlert.size >= MAX_CHUNKS_PER_ALERT) return { chunk: null, created: false, full: true };
  const chunk = {
    alertId,
    kind,
    index,
    storagePath,
    bytes,
    mime,
    uploadedAt: new Date().toISOString(),
  };
  perAlert.set(key, chunk);
  // D27 mirror: one fire-and-forget upsert per new chunk (re-registers
  // are already in the table by id). A failed mirror write never
  // fails the register — memory stays the source of truth for this
  // instance, and the vault reads memory first.
  if (dbStatus().configured) {
    void dbUpsert("evidence_chunks", toRow(chunk));
  }
  return { chunk, created: true };
};

// Row shape (see supabase/migrations/20261119080000_evidence_chunks.sql):
// id = `<alertId>:<kind>:<index>` — the same key as the memory map,
// so the upsert is idempotent on the primary key.
const toRow = (chunk) => ({
  id: `${chunk.alertId}:${chunk.kind}:${chunk.index}`,
  alert_id: chunk.alertId,
  kind: chunk.kind,
  chunk_index: chunk.index,
  storage_path: chunk.storagePath,
  bytes: chunk.bytes,
  mime: chunk.mime,
  uploaded_at: chunk.uploadedAt,
});

const fromRow = (row) => ({
  alertId: row.alert_id,
  kind: row.kind,
  index: row.chunk_index,
  storagePath: row.storage_path,
  bytes: row.bytes,
  mime: row.mime,
  uploadedAt: row.uploaded_at,
});

// Audio first, then video, each by index — the order D27 pairs
// and hash-chains in.
const list = async (alertId) => {
  const perAlert = memory.get(alertId);
  if (perAlert && perAlert.size > 0) {
    return [...perAlert.values()]
      .sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind < b.kind ? -1 : 1))
      .map(toPublic);
  }
  // Memory empty (fresh instance, recycle) — the Postgres mirror is
  // the shared truth. PostgREST orders kind alphabetically, and
  // "audio" < "video", so kind.asc + chunk_index.asc is vault order.
  const res = await dbSelectMany("evidence_chunks", "alert_id", alertId, "kind.asc,chunk_index.asc");
  if (!res.ok) return [];
  return res.rows.map((row) => toPublic(fromRow(row)));
};

const count = (alertId) => memory.get(alertId)?.size ?? 0;

module.exports = {
  register,
  list,
  count,
  toPublic,
  toRow,
  fromRow,
  MAX_CHUNKS_PER_ALERT,
  // Test seams only.
  _clearMemory: () => memory.clear(),
  _size: () => memory.size,
};
