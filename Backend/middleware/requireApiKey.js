// 🔐 API-key auth for the SafeLife backend.
//
// The mutating routes (POST /alert, /location-update, /test-alert) require the
// caller to send a shared secret in the `x-api-key` header. The secret lives
// in the API_SECRET env var — never in code. Compared with a timing-safe
// equality check so response time can't leak the key.
//
// Mobile app: set EXPO_PUBLIC_API_SECRET to the same value; the app sends it
// as the `x-api-key` header on SOS alert requests.
//
// Fail CLOSED: while API_SECRET is unset the gate refuses every mutating
// request (503) instead of letting it through — an unset secret must never
// silently degrade to anonymous access. Set API_SECRET in the hosting
// dashboard (and EXPO_PUBLIC_API_SECRET in the mobile app) to activate
// enforcement. Day-30 (2026-11-22) is when the production value lands;
// until then the backend answers 503 on mutating routes, loudly.
const crypto = require("crypto");
const { audit } = require("../services/audit");

let warned = false;

const requireApiKey = (req, res, next) => {
  const expected = process.env.API_SECRET || "";

  if (!expected) {
    if (!warned) {
      warned = true;
      console.warn(
        "⚠️  API_SECRET is not set — mutating routes refuse requests (503). " +
          "Set API_SECRET (backend) and EXPO_PUBLIC_API_SECRET (mobile app) " +
          "to lock down /alert, /location-update and /test-alert."
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
