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
// Run-3 fix round 2 (1.1/2.1/3.1): the shared-key fallback is GONE.
// requireUserOrKey and middleware/requireApiKey.js are deleted —
// every private route is JWT-only now. Old APKs (≤ #12) that cannot
// send a JWT can no longer call the backend at all; they must update
// to the Day-30 re-ship. The embedded API_SECRET in those APKs is
// retired by rotating API_SECRET at Day-30 activation (his step).
// QStash server-to-server callbacks never used the fallback — they
// carry their own HMAC job tokens (services/escalation.js,
// services/delivery.js, services/journeyEscalation.js) and are
// untouched by this change.
const { verifyUserToken } = require("../services/supabaseAuth");

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
  const { ok, user, lastSignInAt, tokenIat } = await verifyUserToken(token);
  if (!ok) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  req.user = user;
  // Session-freshness signals for re-auth-gated actions (DELETE
  // /auth/account, 12.3). req.user stays exactly { id, email }.
  req.authSession = { lastSignInAt: lastSignInAt || null, tokenIat: tokenIat || null };
  return next();
};

// Ownership helper (3.1): a JWT user may touch a record only when
// the record's owner matches. A missing/null ownerId now DENIES —
// legacy ownerless rows are inaccessible to everyone (they predate
// ownership and cannot be attributed to any user), instead of being
// open to any caller as before. There is no longer a shared-key-only
// caller to exempt: requireUser guarantees req.user is set.
const owns = (req, ownerId) =>
  Boolean(req?.user?.id) && typeof ownerId === "string" && ownerId.length > 0 && req.user.id === ownerId;

module.exports = { requireUser, owns };
