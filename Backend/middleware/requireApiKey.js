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
// Migration note: while API_SECRET is unset the check is skipped (with a loud
// warning at startup) so existing app builds keep working. Set API_SECRET in
// the hosting dashboard to activate enforcement.
const crypto = require("crypto");

let warned = false;

const requireApiKey = (req, res, next) => {
  const expected = process.env.API_SECRET || "";

  if (!expected) {
    if (!warned) {
      warned = true;
      console.warn(
        "⚠️  API_SECRET is not set — API-key auth is DISABLED. " +
          "Set API_SECRET (backend) and EXPO_PUBLIC_API_SECRET (mobile app) " +
          "to lock down /alert, /location-update and /test-alert."
      );
    }
    return next();
  }

  const provided = req.header("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
};

module.exports = requireApiKey;
