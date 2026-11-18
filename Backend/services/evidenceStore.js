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
  return { chunk, created: true };
};

// Audio first, then video, each by index — the order D27 pairs
// and hash-chains in.
const list = (alertId) => {
  const perAlert = memory.get(alertId);
  if (!perAlert) return [];
  return [...perAlert.values()]
    .sort((a, b) => (a.kind === b.kind ? a.index - b.index : a.kind < b.kind ? -1 : 1))
    .map(toPublic);
};

const count = (alertId) => memory.get(alertId)?.size ?? 0;

module.exports = {
  register,
  list,
  count,
  toPublic,
  MAX_CHUNKS_PER_ALERT,
  // Test seams only.
  _clearMemory: () => memory.clear(),
  _size: () => memory.size,
};
