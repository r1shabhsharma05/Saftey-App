// 📲 Signup phone verification — SafeLife phone-OTP signup.
//
// Same code machinery as the guardian flow (services/guardian.js:
// 6 digits, salted SHA-256 hash, 10-min TTL, 5 wrong attempts kills
// the code, max 3 codes/hour per phone) but a SEPARATE namespace:
// signup codes live in their own store keyed by phone, so a guardian
// code can never verify a signup and vice versa. The record shape is
// the one issueCode/verifyCode already operate on ({verification,
// codeRequests}) — this module only owns the namespace, not the math.
//
// Cross-instance: the code lives in services/signupCodeStore.js —
// memory is the fast path, Postgres is the shared truth (same mirror
// as the guardian flow). A verify landing on a different Vercel
// instance loads the hash from the DB instead of answering "No
// verification code pending". The per-hour ledger is NOT mirrored
// (soft counter, restarts empty per instance — same as guardians).
//
// Both functions are async: the code is persisted BEFORE the caller
// sends the SMS, so a crash between send and mirror can never strand
// the user with a code no instance can verify.
const { normalizePhone } = require("./sms");
const { issueCode, verifyCode } = require("./guardian");
const store = require("./signupCodeStore");

// Issues a fresh code for the phone, replacing any pending one.
// Returns the PLAIN code ONLY so the caller (the route) can hand it
// to the SMS adapter — it must never reach a response body or a log.
const issueSignupCode = async (phone) => {
  const clean = normalizePhone(phone);
  if (!clean) throw new Error("Invalid phone number");
  let rec = await store.load(clean);
  if (!rec) rec = { phone: clean, verification: null, codeRequests: [] };
  const { code } = issueCode(rec);
  rec.updatedAt = new Date().toISOString();
  // Durable before the SMS leaves: the route sends only after this
  // returns, so the code is verifiable on any instance by send time.
  await store.save(rec);
  return { phone: clean, code };
};

// Checks a code. Throws on no pending code / expired / killed /
// wrong guess (same messages as the guardian flow). The outcome is
// persisted (attempts bump, consumed/killed/expired clears the code)
// so a second verify on another instance sees the same state — a
// consumed code can never verify twice, on any instance.
const verifySignupCode = async (phone, code) => {
  const clean = normalizePhone(phone);
  if (!clean) throw new Error("Invalid phone number");
  const rec = await store.load(clean);
  if (!rec) throw new Error("No verification code pending");
  try {
    verifyCode(rec, code);
  } finally {
    rec.updatedAt = new Date().toISOString();
    await store.save(rec);
    // Consumed, killed or expired: the code is gone — drop the
    // memory entry (the DB row keeps the cleared state, so a later
    // load still answers "no code pending" instead of reviving it).
    if (!rec.verification) store._drop(clean);
  }
  return { phone: clean };
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
