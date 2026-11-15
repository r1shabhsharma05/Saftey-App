// 🔐 API-key auth for the SafeLife backend.
//
// The shared secret in the API_SECRET env var — never in code.
// Compared with a timing-safe equality check so response time can't
// leak the key.
//
// Run-2: this is now ONLY the time-boxed compat fallback inside
// middleware/requireUser.js (requireUserOrKey) for old APKs that
// cannot send a JWT yet — the app authenticates with its Supabase
// JWT instead, and the secret is NO LONGER injected into APK builds.
// shortcut: fallback for APK ≤ #12, REMOVE at Day-30 re-ship.
// Admin + delete-account routes never use this (JWT only).
//
// Fail CLOSED: while API_SECRET is unset the gate refuses every
// key-only request (503) instead of letting it through — an unset
// secret must never silently degrade to anonymous access. A caller
// with a valid JWT still passes without any key.
const crypto = require("crypto");
const { audit } = require("../services/audit");

let warned = false;

const requireApiKey = (req, res, next) => {
  const expected = process.env.API_SECRET || "";

  if (!expected) {
    if (!warned) {
      warned = true;
      console.warn(
        "⚠️  API_SECRET is not set — shared-key requests refuse (503). " +
          "Set API_SECRET in the hosting dashboard. JWT-authenticated " +
          "calls are unaffected."
      );
    }
    return res.status(503).json({ success: false, error: "Service not configured" });
  }

  const provided = req.header("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    // Audit the rejection — a wrong-key walk against /alert is exactly the
    // probe an attacker runs before finding an open debug route. The key
    // itself is never logged (audit stores a fingerprint only).
    audit("api_key.rejected", { actorKey: provided, ip: req.ip });
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
};

module.exports = requireApiKey;
