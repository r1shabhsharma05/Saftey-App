// 🔐 Login precheck — per-email attempt limiter (2.4).
//
// POST /auth/login/precheck {email} is called by the app BEFORE
// Supabase signInWithPassword. Password login itself is a direct
// client→Supabase call, so no server middleware can rate-limit it —
// this endpoint is the server-side throttle in front of it: each
// call consumes one attempt for that email, and past the cap the
// app is told to stop (429) instead of attempting the sign-in.
//
//   Cap: 10 attempts / 15 min per normalized email.
//
// Bucket: the shared Upstash store (services/redis.js
// checkRateLimit, atomic INCR + TTL) when UPSTASH_* env is set;
// otherwise a per-instance in-memory Map with the same window
// (same degradation as the other limiters — a flood spread across
// cold starts is only partially throttled without Upstash).
// Self-expiring either way: entries older than the window are
// dropped on read.
//
// Privacy: the bucket key is a SHA-256 of the normalized email —
// the raw email never lands in Redis keys or logs.
//
// Honest limitation (state it, don't hide it): this only binds
// callers that go through the app. An attacker can call Supabase
// Auth directly and bypass this endpoint entirely; the real
// backstop is Supabase's own server-side login limits (dashboard,
// CAN'T VERIFY from code). This endpoint also never reveals
// whether the email exists — it never looks the user up, so the
// answer is identical for registered and unregistered emails.
const crypto = require("crypto");
const { checkRateLimit } = require("./redis");

const LOGIN_PRECHECK_LIMIT = 10;
const LOGIN_PRECHECK_WINDOW_SEC = 15 * 60;

// In-memory fallback: normalized-email-hash -> { count, resetAtMs }.
const memoryBuckets = new Map();

const _clearPrecheck = () => memoryBuckets.clear();

const emailKey = (email) => {
  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!clean) return "";
  return crypto.createHash("sha256").update(clean).digest("hex");
};

const memoryCheck = (key) => {
  const now = Date.now();
  const windowMs = LOGIN_PRECHECK_WINDOW_SEC * 1000;
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAtMs <= now) {
    memoryBuckets.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > LOGIN_PRECHECK_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
};

// Returns { allowed, retryAfterSeconds }. Never throws and never
// reveals existence — a store error fails OPEN (the login attempt
// itself is still gated by Supabase), matching the SOS limiter's
// fail-open rationale.
const checkLoginPrecheck = async (email) => {
  const key = emailKey(email);
  if (!key) return { allowed: true, retryAfterSeconds: 0 };
  try {
    const verdict = await checkRateLimit(`login-precheck:${key}`, LOGIN_PRECHECK_LIMIT, LOGIN_PRECHECK_WINDOW_SEC);
    if (verdict) {
      return {
        allowed: verdict.count <= LOGIN_PRECHECK_LIMIT,
        retryAfterSeconds: verdict.allowed
          ? 0
          : LOGIN_PRECHECK_WINDOW_SEC,
      };
    }
  } catch {
    // Fall through to the in-memory bucket below.
  }
  return memoryCheck(key);
};

module.exports = {
  checkLoginPrecheck,
  LOGIN_PRECHECK_LIMIT,
  LOGIN_PRECHECK_WINDOW_SEC,
  // Test seam only.
  _clearPrecheck,
};
