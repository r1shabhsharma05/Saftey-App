// 📲 Phone-code issue/verify — shared by the signup and login-code flows.
//
// Same code machinery as the guardian flow (services/guardian.js:
// 6 digits, salted SHA-256 hash, 10-min TTL, 5 wrong attempts kills
// the code, max 3 codes/hour per phone) but a SEPARATE namespace per
// store: a login code can never verify a signup and vice versa.
//
// Cross-instance: memory is the fast path, Postgres is the shared
// truth (services/codeStore.js). Both functions are async: the code
// is persisted BEFORE the caller sends the SMS, so a crash between
// send and mirror can never strand the user with a code no instance
// can verify.
//
// Run-2 fixes, all in this one place so both namespaces get them:
// - R1d: the per-hour ledger is mirrored (code_requests) and the
//   memory entry is NEVER dropped on consume/kill — the ledger row
//   lives until its window lapses, so the 3/hr cap cannot reset.
// - R1e: a successful verify atomically consumes the code with one
//   conditional Postgres update (store.consume); zero rows means
//   another instance already consumed it.
// - R1j: the issue path throws when the mirror save fails (the route
//   then 502s WITHOUT sending the SMS); the verify path retries the
//   mirror save once, then deletes the Postgres row directly, so a
//   stale live hash can never revive a consumed/killed code.
//   A mirror-timeout is logged distinctly from a confirmed failure,
//   and an unconfigured DB (memory-only) is not a failure at all.
const { normalizePhone } = require("./sms");
const { issueCode, verifyCode } = require("./guardian");
const { dbStatus, dbDelete } = require("./supabaseDb");

const createPhoneCodeService = (store) => {
  // Issues a fresh code for the phone, replacing any pending one.
  // Returns the PLAIN code ONLY so the caller (the route) can hand it
  // to the SMS adapter — it must never reach a response body or a log.
  // Throws "could-not-persist-code" when the DB is configured but the
  // mirror save failed: a code nobody can verify must never be SMSed.
  const issuePhoneCode = async (phone) => {
    const clean = normalizePhone(phone);
    if (!clean) throw new Error("Invalid phone number");
    let rec = await store.load(clean);
    if (!rec) rec = { phone: clean, verification: null, codeRequests: [], proof: null };
    const prevVerification = rec.verification;
    // A fresh code retires any unspent proof from an earlier verify —
    // the proof must come from the latest verification, not a stale one.
    rec.proof = null;
    const { code } = issueCode(rec);
    rec.updatedAt = new Date().toISOString();
    // Durable before the SMS leaves: the route sends only after this
    // returns, so the code is verifiable on any instance by send time.
    const saved = await store.save(rec);
    if (!saved.ok && saved.reason !== "not_configured") {
      // Roll the un-persisted code back out of memory: it must never
      // verify anywhere. The ledger push stays — the attempt happened.
      rec.verification = prevVerification;
      console.log(`❌ code mirror save failed (${saved.reason}) — code NOT issued`);
      throw new Error("could-not-persist-code");
    }
    return { phone: clean, code };
  };

  // Checks a code. Throws on no pending code / expired / killed /
  // wrong guess (same messages as the guardian flow). The outcome is
  // persisted (attempts bump, consumed/killed/expired clears the code)
  // so a second verify on another instance sees the same state.
  // Returns { phone, record } — the record carries the kept ledger
  // (R1d) and, for signup, is where the caller mints the proof.
  const verifyPhoneCode = async (phone, code) => {
    const clean = normalizePhone(phone);
    if (!clean) throw new Error("Invalid phone number");
    const rec = await store.load(clean);
    if (!rec) throw new Error("No verification code pending");
    const old = rec.verification ? { ...rec.verification } : null;
    try {
      verifyCode(rec, code);
    } catch (err) {
      rec.updatedAt = new Date().toISOString();
      const saved = await store.save(rec);
      if (!saved.ok && saved.reason !== "not_configured") {
        console.log(`❌ code mirror save failed (${saved.reason}) — attempts may not persist cross-instance`);
      }
      throw err;
    }
    // Success: atomic cross-instance consume (R1e). When the DB is
    // configured and the PATCH matches zero rows, another instance
    // already consumed this code — restore it in memory only (never
    // save: the winning instance owns the row now) and fail generic.
    if (dbStatus().configured && old?.hash) {
      const res = await store.consume(clean, old.hash, old.attempts ?? 0);
      if (res.ok && !res.consumed) {
        rec.verification = old;
        throw new Error("Invalid or expired code");
      }
      if (!res.ok) {
        console.log(`❌ code atomic consume failed (${res.reason}) — continuing with mirror save`);
      }
    }
    // Persist the consumed state (R1j verify path): retry the mirror
    // save once, then delete the Postgres row directly so a stale
    // live hash can never revive this code on a fresh instance.
    rec.updatedAt = new Date().toISOString();
    const saved = await store.save(rec);
    if (!saved.ok && saved.reason !== "not_configured") {
      console.log(`❌ code mirror save failed (${saved.reason}) — retrying once`);
      const retry = await store.save(rec);
      if (!retry.ok && retry.reason !== "not_configured") {
        console.log(`❌ code mirror save failed again (${retry.reason}) — deleting Postgres row directly`);
        await dbDelete(store.table, "phone", clean);
      }
    }
    return { phone: clean, record: rec };
  };

  return { issuePhoneCode, verifyPhoneCode };
};

module.exports = { createPhoneCodeService };
