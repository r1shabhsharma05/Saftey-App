// 🔐 Per-user session auth — Supabase JWT verified server-side (2.1).
//
// requireUser: the app sends `Authorization: Bearer <Supabase access
// token>` on every backend call; this verifies it against Supabase
// Auth (GET /auth/v1/user) and sets req.user = { id, email }. No
// client claim is trusted — userId/userName/ownerId always come from
// this, never from the request body (3.1). A missing/invalid token
// is a plain 401; an unconfigured backend cannot verify anyone, so
// it 401s too (fail closed).
//
// requireUserOrKey: the same JWT check, with the shared x-api-key as
// a fallback for old APKs. shortcut: fallback for APK ≤ #12, REMOVE
// at Day-30 re-ship — APK #12 cannot send a JWT, and the Day-24
// drill needs it working. Every shared-key-only authentication is
// audit-logged (auth.shared_key_fallback). Admin + delete-account
// routes use requireUser (JWT ONLY, no fallback).
const { verifyUserToken } = require("../services/supabaseAuth");
const requireApiKey = require("./requireApiKey");
const { audit } = require("../services/audit");

const bearerToken = (req) => {
  const h = req.header("authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1].trim() : "";
};

const requireUser = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  const { ok, user } = await verifyUserToken(token);
  if (!ok) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  req.user = user;
  return next();
};

const requireUserOrKey = async (req, res, next) => {
  const token = bearerToken(req);
  if (token) {
    const { ok, user } = await verifyUserToken(token);
    if (ok) {
      req.user = user;
      return next();
    }
    // An invalid/expired JWT falls through to the shared-key check
    // instead of 401ing outright — an old APK sends no JWT at all,
    // and a caller carrying the key must not be locked out by a stale
    // token. A caller with neither a valid JWT nor the key still 401s
    // below, via requireApiKey.
  }
  return requireApiKey(req, res, () => {
    audit("auth.shared_key_fallback", { ip: req.ip, meta: { path: req.path } });
    return next();
  });
};

// Ownership helper (3.1): a JWT user may touch a record only when
// the record's owner matches — or when the record predates ownership
// (ownerId null, legacy rows). A shared-key-only caller (no req.user)
// is the compat path and is not ownership-checked here; the audit
// line in requireUserOrKey records that it happened.
const owns = (req, ownerId) => !req.user || !ownerId || req.user.id === ownerId;

module.exports = { requireUser, requireUserOrKey, owns };
