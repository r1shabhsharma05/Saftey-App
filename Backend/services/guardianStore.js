// 🗄️ Guardian store — in-memory guardians with Postgres persistence (D19).
//
// Same shape as services/journeyStore.js (D16): one Vercel instance's
// memory is not shared, so the Map is the fast path and Postgres
// (when configured) is the shared truth. save() always writes memory
// and, when configured, upserts the row fire-and-forget — a guardian
// register must never wait on the DB. get() tries memory first, then
// Postgres.
//
// Two deliberate differences from journeyStore:
// - The store is keyed by id AND by phone (one guardian per phone —
//   the register route dedupes on it). getByPhone falls back to a
//   PostgREST phone lookup (dbSelectBy) so a re-register on another
//   instance still finds the existing record instead of duplicating it.
// - The store is BOUNDED (1000 guardians). Eviction takes the oldest
//   *pending* guardian (unverified, not yet a rescuer); a VERIFIED
//   guardian is NEVER evicted — dropping one would strand a rescuer
//   mid-availability. When the store is full of verified guardians,
//   save() refuses (returns false) and the register route answers 503.
//
// The verification code IS mirrored (salted hash + salt + expiry +
// attempts): a verify landing on a different instance must still
// succeed — the 5-attempt limit is enforced by the store, not by
// hash secrecy, and the hash lives in a service_role-only table
// (migration 20261111080000, RLS lockdown). The per-hour request
// ledger (codeRequests) is NOT mirrored — it is a soft anti-abuse
// counter, and mirroring it would buy nothing. A row written before
// D19 has no code columns: fromRow reads verification: null, exactly
// as if no code were pending.
//
// Row shape (see supabase/migrations/20261111080000_guardians.sql):
// id, user_id, name, phone (unique), role, state, available,
// verified_at, code_hash, code_salt, code_expires_at, code_attempts,
// created_at, updated_at.
const { dbStatus, dbUpsert, dbSelectOne, dbSelectBy } = require("./supabaseDb");
const { normalizePhone } = require("./sms");

const MAX_GUARDIANS = 1000;

const memory = new Map();
const phoneIndex = new Map();

const toRow = (guardian) => ({
  id: guardian.id,
  user_id: guardian.userId || "",
  name: guardian.name || "",
  phone: guardian.phone,
  role: guardian.role,
  state: guardian.state,
  available: guardian.available,
  verified_at: guardian.verifiedAt ?? null,
  code_hash: guardian.verification?.hash ?? null,
  code_salt: guardian.verification?.salt ?? null,
  code_expires_at: guardian.verification?.expiresAt ?? null,
  code_attempts: guardian.verification?.attempts ?? 0,
  created_at: guardian.createdAt,
  updated_at: guardian.updatedAt,
});

const fromRow = (row) => ({
  id: row.id,
  userId: row.user_id || "",
  name: row.name || "",
  phone: row.phone,
  role: row.role,
  state: row.state,
  available: Boolean(row.available),
  verifiedAt: row.verified_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // A code issued before this read: rebuild it from the mirrored
  // columns so verifyCode can check it on this instance too.
  verification: row.code_hash
    ? {
        hash: row.code_hash,
        salt: row.code_salt ?? "",
        expiresAt: row.code_expires_at,
        attempts: row.code_attempts ?? 0,
      }
    : null,
  codeRequests: [],
});

const save = (guardian) => {
  if (!memory.has(guardian.id) && memory.size >= MAX_GUARDIANS) {
    // New guardian needs a slot: evict pending ones (oldest first).
    // If every guardian is verified there is no safe victim — refuse
    // (false) instead of stranding a rescuer. The caller answers
    // 503; the user retries.
    for (const g of [...memory.values()]) {
      if (memory.size < MAX_GUARDIANS) break;
      if (g.state !== "verified") {
        memory.delete(g.id);
        if (phoneIndex.get(g.phone) === g.id) phoneIndex.delete(g.phone);
      }
    }
    if (memory.size >= MAX_GUARDIANS) return false;
  }
  memory.set(guardian.id, guardian);
  phoneIndex.set(guardian.phone, guardian.id);
  // Fire-and-forget by design: returns the promise so tests can await
  // it, but callers on the request path must not await it.
  if (dbStatus().configured) return dbUpsert("guardians", toRow(guardian));
  return undefined;
};

const get = async (id) => {
  if (memory.has(id)) return memory.get(id);
  if (!dbStatus().configured) return null;
  const res = await dbSelectOne("guardians", id);
  return res.ok ? fromRow(res.row) : null;
};

const getByPhone = async (phone) => {
  const clean = normalizePhone(phone);
  if (!clean) return null;
  if (phoneIndex.has(clean)) return memory.get(phoneIndex.get(clean)) || null;
  if (!dbStatus().configured) return null;
  const res = await dbSelectBy("guardians", "phone", clean);
  if (!res.ok) return null;
  const guardian = fromRow(res.row);
  // Seed memory so the next read is local — but never evict for a
  // seed: if the store is full, the seed is simply skipped.
  if (memory.size < MAX_GUARDIANS) {
    memory.set(guardian.id, guardian);
    phoneIndex.set(guardian.phone, guardian.id);
  }
  return guardian;
};

module.exports = {
  save,
  get,
  getByPhone,
  MAX_GUARDIANS,
  // Test seams only.
  _clearMemory: () => {
    memory.clear();
    phoneIndex.clear();
  },
  _size: () => memory.size,
  _has: (id) => memory.has(id),
};
