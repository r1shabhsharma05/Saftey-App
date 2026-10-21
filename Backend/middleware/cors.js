// 🔒 CORS lockdown.
//
// The API is consumed by the native mobile app (which sends no `Origin`
// header, so CORS never applies to it) and optionally by the Expo web
// client. A wildcard `Access-Control-Allow-Origin: *` would let *any*
// website in a browser call the mutating POST routes — every /alert hit
// spams the user's Telegram emergency contacts, so this is a real abuse
// vector, especially while API_SECRET is still unset (warn-and-allow).
//
// Set CORS_ALLOWED_ORIGINS to a comma-separated allowlist, e.g.
//   CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:8081
// Unset (the default) = fail closed: no CORS headers are emitted at all,
// so cross-site browser calls are blocked while native/curl callers —
// which send no Origin — keep working untouched.
//
// x-api-key is allowlisted as a header: without it, browsers refuse to
// send the API key on cross-origin requests (preflight rejects it).
const cors = require("cors");

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

module.exports = cors({
  // `false` disables CORS entirely — no Access-Control-* headers emitted.
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 600,
});
