// 🗄️ Phone-code store factory — in-memory codes with Postgres persistence.
//
// Run-2: signupCodeStore.js and loginCodeStore.js are both instances of
// this factory (same columns, different tables). One Vercel instance's
// memory is not shared, so the Map is the fast path and Postgres (when
// configured) is the shared truth. A code issued on instance A must
// verify on instance B.
//
// The row holds ONLY the salted hash (never the plain code). Run-2 R1d:
// the per-hour request ledger (codeRequests, timestamps only) IS
// mirrored now (code_requests jsonb), so the 3/hr cap survives a
// consume/kill/expiry and a cross-instance load. The signup proof
// hash (proof_hash/proof_expires_at) is mirrored only for the signup
// table (withProof), never for login codes.
//
// save() is awaited by the phone-code service (with a 1.5 s race so a
// dead DB cannot stall signup): the code must be durable BEFORE the
// SMS is sent, or a crash between send and mirror strands the user
// with a code no instance can verify. Until the migration is applied
// the upsert fails closed (logged, { ok: false }) and the flow
// degrades to memory-only — the same behaviour as before this store.
const { dbStatus, dbUpsert, dbSelectBy, dbConditionalUpdate } = require("./supabaseDb");
const { normalizePhone } = require("./sms");

const MAX_PHONES = 1000;
const MIRROR_TIMEOUT_MS = 1500;

const createCodeStore = (table, { withProof = false } = {}) => {
  const memory = new Map(); // normalized phone -> { phone, verification, codeRequests, proof, updatedAt }

  const toRow = (rec) => ({
    id: rec.phone,
    phone: rec.phone,
    code_hash: rec.verification?.hash ?? null,
    code_salt: rec.verification?.salt ?? null,
    code_expires_at: rec.verification?.expiresAt ?? null,
    code_attempts: rec.verification?.attempts ?? 0,
    // R1d: timestamps only, never codes.
    code_requests: Array.isArray(rec.codeRequests) ? rec.codeRequests : [],
    ...(withProof
      ? {
          proof_hash: rec.proof?.hash ?? null,
          proof_expires_at: rec.proof?.expiresAt ?? null,
        }
      : {}),
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
    // R1d: the ledger comes back from the mirror instead of
    // restarting empty on every cross-instance load.
    codeRequests: Array.isArray(row.code_requests) ? row.code_requests : [],
    ...(withProof
      ? {
          proof: row.proof_hash
            ? { hash: row.proof_hash, expiresAt: row.proof_expires_at }
            : null,
        }
      : {}),
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
    const mirror = dbUpsert(table, toRow(rec));
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
    const res = await dbSelectBy(table, "phone", clean);
    if (!res.ok) return null;
    const rec = fromRow(res.row);
    if (memory.size < MAX_PHONES) memory.set(clean, rec);
    return rec;
  };

  // Run-2 R1e: atomic cross-instance consume — one conditional PATCH
  // (WHERE phone AND code_hash AND code_attempts < 5). Zero matched
  // rows means another instance already consumed this code.
  const consume = async (phone, expectedHash, attempts = 0) => {
    const clean = normalizePhone(phone);
    if (!clean) return { ok: false, reason: "invalid-phone" };
    if (!dbStatus().configured) return { ok: false, reason: "not_configured" };
    const res = await dbConditionalUpdate(
      table,
      [
        { column: "phone", op: "eq", value: clean },
        { column: "code_hash", op: "eq", value: expectedHash },
        { column: "code_attempts", op: "lt", value: 5 },
      ],
      { code_hash: null, code_expires_at: null, code_attempts: attempts }
    );
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, consumed: res.rows.length > 0 };
  };

  return {
    table,
    save,
    load,
    consume,
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
};

module.exports = { createCodeStore, MAX_PHONES, MIRROR_TIMEOUT_MS };
