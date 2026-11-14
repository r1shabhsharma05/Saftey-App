// 🗄️ Signup-code store — in-memory codes with Postgres persistence.
//
// Same shape as services/guardianStore.js: one Vercel instance's
// memory is not shared, so the Map is the fast path and Postgres
// (when configured) is the shared truth. A code issued on instance A
// must verify on instance B, or signup 409s "No verification code
// pending" for a code the user really received.
//
// The row holds ONLY the salted hash (never the plain code), the
// same columns the guardians table mirrors (migration
// 20261114180000_signup_codes.sql, RLS lockdown, service_role only).
// The per-hour request ledger (codeRequests) is NOT mirrored — a soft
// anti-abuse counter, same as the guardian flow.
//
// save() is awaited by the signup service (with a 1.5 s race so a
// dead DB cannot stall signup): the code must be durable BEFORE the
// SMS is sent, or a crash between send and mirror strands the user
// with a code no instance can verify. Until the migration is applied
// the upsert fails closed (logged, { ok: false }) and the flow
// degrades to memory-only — the same behaviour as before this store.
const { dbStatus, dbUpsert, dbSelectBy } = require("./supabaseDb");
const { normalizePhone } = require("./sms");

const MAX_PHONES = 1000;
const MIRROR_TIMEOUT_MS = 1500;

const memory = new Map(); // normalized phone -> { phone, verification, codeRequests, updatedAt }

const toRow = (rec) => ({
  id: rec.phone,
  phone: rec.phone,
  code_hash: rec.verification?.hash ?? null,
  code_salt: rec.verification?.salt ?? null,
  code_expires_at: rec.verification?.expiresAt ?? null,
  code_attempts: rec.verification?.attempts ?? 0,
  updated_at: rec.updatedAt ?? new Date().toISOString(),
});

const fromRow = (row) => ({
  phone: row.phone,
  verification: row.code_hash
    ? {
        hash: row.code_hash,
        salt: row.code_salt ?? "",
        expiresAt: row.code_expires_at,
        attempts: row.code_attempts ?? 0,
      }
    : null,
  // A code issued before this read: the ledger restarts empty on
  // this instance — the per-hour cap is a soft counter, same as
  // the guardian flow, and mirroring it would buy nothing.
  codeRequests: [],
  updatedAt: row.updated_at,
});

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Writes memory immediately; mirrors to Postgres unless the DB is
// unconfigured, and never waits longer than MIRROR_TIMEOUT_MS — a
// dead DB must not stall signup. Returns the mirror promise's
// outcome for tests; callers on the request path await it.
const save = async (rec) => {
  if (!memory.has(rec.phone) && memory.size >= MAX_PHONES) {
    for (const [p, r] of memory) {
      if (!r.verification) memory.delete(p);
      if (memory.size < MAX_PHONES) break;
    }
  }
  memory.set(rec.phone, rec);
  if (!dbStatus().configured) return { ok: false, reason: "not_configured" };
  const mirror = dbUpsert("signup_codes", toRow(rec));
  return Promise.race([
    mirror,
    timeout(MIRROR_TIMEOUT_MS).then(() => ({ ok: false, reason: "mirror-timeout" })),
  ]);
};

// Memory first, then Postgres — so a verify landing on another
// instance still finds the code. Seeds memory on a DB hit (never
// evicting for a seed).
const load = async (phone) => {
  const clean = normalizePhone(phone);
  if (!clean) return null;
  if (memory.has(clean)) return memory.get(clean);
  if (!dbStatus().configured) return null;
  const res = await dbSelectBy("signup_codes", "phone", clean);
  if (!res.ok) return null;
  const rec = fromRow(res.row);
  if (memory.size < MAX_PHONES) memory.set(clean, rec);
  return rec;
};

module.exports = {
  save,
  load,
  MAX_PHONES,
  // Test seams only.
  _clearMemory: () => memory.clear(),
  _peek: (phone) => {
    const clean = normalizePhone(phone);
    return clean ? memory.get(clean) ?? null : null;
  },
  _drop: (phone) => {
    const clean = normalizePhone(phone);
    if (clean) memory.delete(clean);
  },
  _has: (phone) => {
    const clean = normalizePhone(phone);
    return clean ? memory.has(clean) : false;
  },
};
