// 📲 Signup phone verification — SafeLife phone-OTP signup.
//
// Same code machinery as the guardian flow (services/guardian.js:
// 6 digits, salted SHA-256 hash, 10-min TTL, 5 wrong attempts kills
// the code, max 3 codes/hour per phone) but a SEPARATE namespace:
// signup codes live in their own Map keyed by phone, so a guardian
// code can never verify a signup and vice versa. The record shape is
// the one issueCode/verifyCode already operate on ({verification,
// codeRequests}) — this module only owns the namespace, not the math.
//
// Cross-instance caveat (same as the in-memory strikes): the code
// lives in this instance's memory only — a verify landing on a
// different Vercel instance answers "No verification code pending"
// and the app re-requests. The guardian flow mirrors its hash to
// Postgres; signup has no table for that yet, so no mirror here.
// A verify that fails this way is a retry, not a lockout.
const { normalizePhone } = require("./sms");
const { issueCode, verifyCode } = require("./guardian");

// One small record per phone that ever asked for a code. Bounded:
// at 1000 phones, entries with no live code are evicted first.
const MAX_PHONES = 1000;

const memory = new Map(); // normalized phone -> { verification, codeRequests }

const getRecord = (phone) => {
  const clean = normalizePhone(phone);
  if (!clean) return null;
  let rec = memory.get(clean);
  if (!rec) {
    if (memory.size >= MAX_PHONES) {
      for (const [p, r] of memory) {
        if (!r.verification) memory.delete(p);
        if (memory.size < MAX_PHONES) break;
      }
    }
    if (memory.size >= MAX_PHONES) {
      throw new Error("Too many pending verifications — try again shortly");
    }
    rec = { verification: null, codeRequests: [] };
    memory.set(clean, rec);
  }
  return { clean, rec };
};

// Issues a fresh code for the phone, replacing any pending one.
// Returns the PLAIN code ONLY so the caller (the route) can hand it
// to the SMS adapter — it must never reach a response body or a log.
const issueSignupCode = (phone) => {
  const found = getRecord(phone);
  if (!found) throw new Error("Invalid phone number");
  const { code } = issueCode(found.rec);
  return { phone: found.clean, code };
};

// Checks a code. Throws on no pending code / expired / killed /
// wrong guess (same messages as the guardian flow). A consumed,
// expired or killed code leaves no live verification behind, so the
// entry is dropped — a stale code can never verify later.
const verifySignupCode = (phone, code) => {
  const clean = normalizePhone(phone);
  if (!clean) throw new Error("Invalid phone number");
  const rec = memory.get(clean);
  if (!rec) throw new Error("No verification code pending");
  try {
    verifyCode(rec, code);
  } finally {
    if (!rec.verification) memory.delete(clean);
  }
  return { phone: clean };
};

module.exports = {
  issueSignupCode,
  verifySignupCode,
  // Test seams only.
  _hasPending: (phone) => {
    const clean = normalizePhone(phone);
    const rec = clean ? memory.get(clean) : null;
    return !!rec?.verification;
  },
  _clearMemory: () => memory.clear(),
};
