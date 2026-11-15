// 📲 Signup phone verification — SafeLife phone-OTP signup.
//
// Same code machinery as the guardian flow (services/guardian.js:
// 6 digits, salted SHA-256 hash, 10-min TTL, 5 wrong attempts kills
// the code, max 3 codes/hour per phone) but a SEPARATE namespace:
// signup codes live in their own store keyed by phone, so a guardian
// code can never verify a signup and vice versa. The issue/verify
// mechanics live in services/phoneCode.js (shared with the login
// flow); this module only owns the signup namespace + the proof
// token minted on a successful verify (R1c).
//
// Cross-instance: the code lives in services/signupCodeStore.js —
// memory is the fast path, Postgres is the shared truth (same mirror
// as the guardian flow). A verify landing on a different Vercel
// instance loads the hash from the DB instead of answering "No
// verification code pending". The per-hour ledger IS mirrored now
// (R1d) and the memory entry is never dropped on consume/kill.
const { normalizePhone } = require("./sms");
const { createPhoneCodeService } = require("./phoneCode");
const { mintSignupProof } = require("./signupProof");
const store = require("./signupCodeStore");

const { issuePhoneCode, verifyPhoneCode } = createPhoneCodeService(store);

// Issues a fresh code for the phone, replacing any pending one.
// Returns the PLAIN code ONLY so the caller (the route) can hand it
// to the SMS adapter — it must never reach a response body or a log.
const issueSignupCode = issuePhoneCode;

// Checks a code and, on success, mints the single-use proof token
// (R1c) the complete step must present. Throws on no pending code /
// expired / killed / wrong guess (same messages as the guardian
// flow). Returns { phone, proof } — proof is null only when no
// signing secret is configured, in which case complete cannot run.
const verifySignupCode = async (phone, code) => {
  const { phone: clean, record } = await verifyPhoneCode(phone, code);
  const proof = mintSignupProof(clean);
  if (proof) {
    record.proof = { hash: proof.hash, expiresAt: proof.expiresAt };
    const saved = await store.save(record);
    if (!saved.ok && saved.reason !== "not_configured") {
      console.log(`❌ signup proof mirror save failed (${saved.reason}) — proof is memory-only on this instance`);
    }
  }
  return { phone: clean, proof: proof?.token ?? null };
};

module.exports = {
  issueSignupCode,
  verifySignupCode,
  // Test seams only.
  _hasPending: (phone) => {
    const clean = normalizePhone(phone);
    if (!clean) return false;
    // Memory-only peek (the route path always loads through the
    // store); used by tests to assert "no code was issued".
    const rec = store._peek(clean);
    return !!rec?.verification;
  },
  _clearMemory: () => store._clearMemory(),
};
