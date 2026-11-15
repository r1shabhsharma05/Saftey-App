// 🔏 Signup proof token — binds a verified phone to account creation (R1c).
//
// POST /auth/signup/verify-code mints this after a correct code; POST
// /auth/signup/complete must present it before the backend creates the
// account. Format mirrors the alert-view token (expiry.HMAC, keyed by
// PROOF_SECRET — a dedicated server-only signing key, set in the
// hosting dashboard, never in the app, never gates any route; falls
// back to API_SECRET only when PROOF_SECRET is unset):
// the hash of a presented proof is stored on the signup_codes row and
// cleared on first use, so a replayed proof fails even on another
// instance. The plain proof travels only in the verify response and
// the complete request body, never in a log.
const crypto = require("crypto");

const PROOF_TTL_MS = 10 * 60 * 1000;

const mintSignupProof = (phone, nowMs = Date.now()) => {
  const secret = process.env.PROOF_SECRET || process.env.API_SECRET || "";
  if (!secret || typeof phone !== "string" || !phone) return null;
  const expiresAtMs = nowMs + PROOF_TTL_MS;
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`signup-proof:${phone}:${expiresAtMs}`)
    .digest("hex");
  const token = `${expiresAtMs}.${mac}`;
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
};

// The stored proof (rec.proof) is the single-use record: it must exist,
// be unexpired, and match the presented token's hash. The HMAC is also
// recomputed so a token minted for another phone/expiry fails even if
// a row were hand-edited.
const verifySignupProof = (phone, token, rec, nowMs = Date.now()) => {
  const secret = process.env.PROOF_SECRET || process.env.API_SECRET || "";
  if (!secret || typeof token !== "string" || !rec?.proof?.hash) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) return false;
  if (rec.proof.expiresAt && Date.parse(rec.proof.expiresAt) <= nowMs) return false;
  const expected = mintSignupProof(phone, expiresAtMs - PROOF_TTL_MS);
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected.token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const presentedHash = crypto.createHash("sha256").update(token).digest("hex");
  const c = Buffer.from(presentedHash);
  const d = Buffer.from(rec.proof.hash);
  return c.length === d.length && crypto.timingSafeEqual(c, d);
};

module.exports = { mintSignupProof, verifySignupProof, PROOF_TTL_MS };
