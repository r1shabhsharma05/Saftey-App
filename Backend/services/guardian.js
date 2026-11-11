// 🛡️ Guardian onboarding — lifecycle + phone verification (SafeLife 2.0
// Day 19, plan §6 D19, plan §3 F2).
//
// A guardian is a verified app user who can be called on when someone
// nearby needs help. Cold-start per plan §7.5: guardians are the user's
// own trusted people (family/friends) first — the public crowd network
// only works once users exist, so D19 onboards the trusted circle.
//
// Identity (honest limitation): the guardian is keyed by the Supabase
// user id the app sends plus a phone it proves it owns. The backend
// cannot verify "this caller is Supabase user X" — there is no per-user
// JWT verification in this backend, only the shared x-api-key — so
// `userId` here is a caller claim, exactly like journey `userName`
// (D16). The real binding is the PHONE: the SMS code proves the
// registrant controls the number. Per-user JWT verification is a
// D23/D24 security-review item, not D19 scope.
//
// "ID-lite" (plan F2) is therefore: a Google-verified app account
// (Google sign-in verifies the email identity) + phone ownership via
// SMS code. No ID document is collected — there is no provider to
// check one against, so collecting it would be fake security.
//
// Verification code: 6 digits, salted SHA-256 hash (never the code
// itself), 10-min expiry, 5 wrong attempts kills the code, max 3
// codes/hour per phone. The hash lives in the store (and its Postgres
// mirror, same RLS lockdown as journeys) so a verify landing on a
// different Vercel instance can still succeed — the 5-attempt limit
// is enforced by the store, not by hash secrecy. issueCode returns
// the PLAIN code to its in-process caller only: the route hands it to
// the SMS adapter and NEVER puts it in a response.
//
// Pure module, no I/O: routes own persistence (services/
// guardianStore.js) and the SMS send. Throws on invalid input —
// callers must never record a guardian the machine cannot be in.
const crypto = require("crypto");
const { normalizePhone } = require("./sms");

const GUARDIAN_ROLES = ["family", "friend", "volunteer", "security"];
const GUARDIAN_STATES = ["pending", "verified"];

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;
const CODE_REQUEST_WINDOW_MS = 60 * 60 * 1000;

const hashCode = (salt, code) =>
  crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

const createGuardian = ({ userId, name, phone, role } = {}) => {
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid || uid.length > 128) throw new Error("Invalid guardian user");
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName || cleanName.length > 100) throw new Error("Invalid guardian name");
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new Error("Invalid phone number");
  if (!GUARDIAN_ROLES.includes(role)) throw new Error("Invalid guardian role");
  const createdAt = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    userId: uid,
    name: cleanName,
    phone: cleanPhone,
    role,
    state: "pending",
    available: false,
    verifiedAt: null,
    createdAt,
    updatedAt: createdAt,
    // Verification state: null until a code is issued. codeRequests
    // is the per-hour cap ledger (pruned on issue) — in-memory only,
    // never mirrored (see guardianStore.js toRow).
    verification: null,
    codeRequests: [],
  };
};

// Issues a fresh code, replacing any pending one. Throws when the
// per-hour cap is hit. Returns the plain code ONLY so the caller
// (the route) can hand it to the SMS adapter — it must never reach
// a response body or a log line.
const issueCode = (guardian, { nowMs = Date.now() } = {}) => {
  const windowStart = nowMs - CODE_REQUEST_WINDOW_MS;
  guardian.codeRequests = (Array.isArray(guardian.codeRequests) ? guardian.codeRequests : [])
    .filter((t) => t > windowStart);
  if (guardian.codeRequests.length >= MAX_CODES_PER_HOUR) {
    throw new Error("Too many verification codes requested — try again later");
  }
  guardian.codeRequests.push(nowMs);
  const code = String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  const salt = crypto.randomBytes(16).toString("hex");
  guardian.verification = {
    hash: hashCode(salt, code),
    salt,
    expiresAt: new Date(nowMs + CODE_TTL_MS).toISOString(),
    attempts: 0,
  };
  guardian.updatedAt = new Date(nowMs).toISOString();
  return { code };
};

// Checks a code against the pending one. Wrong guesses count toward
// the 5-attempt kill; an expired or exhausted code is cleared so a
// stale code can never verify later. Comparison is constant-time
// over equal-length hashes (both are SHA-256 hex).
const verifyCode = (guardian, code, { nowMs = Date.now() } = {}) => {
  const v = guardian.verification;
  if (!v || typeof v.hash !== "string") throw new Error("No verification code pending");
  if (Date.parse(v.expiresAt) <= nowMs) {
    guardian.verification = null;
    guardian.updatedAt = new Date(nowMs).toISOString();
    throw new Error("Verification code expired — request a new code");
  }
  const attemptHash = hashCode(v.salt, typeof code === "string" ? code : "");
  const match =
    attemptHash.length === v.hash.length &&
    crypto.timingSafeEqual(Buffer.from(attemptHash), Buffer.from(v.hash));
  if (!match) {
    v.attempts += 1;
    if (v.attempts >= MAX_CODE_ATTEMPTS) {
      guardian.verification = null;
      guardian.updatedAt = new Date(nowMs).toISOString();
      throw new Error("Too many attempts — request a new code");
    }
    guardian.updatedAt = new Date(nowMs).toISOString();
    throw new Error(`Invalid verification code (${MAX_CODE_ATTEMPTS - v.attempts} attempts left)`);
  }
  guardian.state = "verified";
  guardian.verifiedAt = new Date(nowMs).toISOString();
  guardian.verification = null;
  guardian.updatedAt = new Date(nowMs).toISOString();
  return guardian;
};

// Availability is meaningful only once verified: an unverified
// guardian must never receive a D20/D21 alert, so the toggle refuses
// while pending (409 at the route, thrown here).
const setAvailable = (guardian, available) => {
  if (typeof available !== "boolean") throw new Error("Invalid availability value");
  if (guardian.state !== "verified") {
    throw new Error("Guardian must be verified before going available");
  }
  guardian.available = available;
  guardian.updatedAt = new Date().toISOString();
  return guardian;
};

// Owner-visible shape: everything the app needs, nothing secret.
// The code hash/salt/expiry/attempts and the request ledger never
// leave the server — a read of one's own record must not leak the
// material a brute-force needs.
const toPublic = (guardian) => ({
  id: guardian.id,
  userId: guardian.userId,
  name: guardian.name,
  phone: guardian.phone,
  role: guardian.role,
  state: guardian.state,
  available: guardian.available,
  verifiedAt: guardian.verifiedAt,
  createdAt: guardian.createdAt,
  updatedAt: guardian.updatedAt,
});

module.exports = {
  GUARDIAN_ROLES,
  GUARDIAN_STATES,
  CODE_LENGTH,
  CODE_TTL_MS,
  MAX_CODE_ATTEMPTS,
  MAX_CODES_PER_HOUR,
  createGuardian,
  issueCode,
  verifyCode,
  setAvailable,
  toPublic,
};
