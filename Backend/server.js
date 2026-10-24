// SafeLife AI — Emergency Backend (Express).
//
// Thin assembly: middleware + route mounting only. Business logic lives in
// services/ (telegram, sos, safePlaces, audit); request handling in routes/.
// (D1 services-architecture restructure — previously everything was inline
// in this file.)
const express = require("express");
const corsMiddleware = require("./middleware/cors");
const helmet = require("helmet");

const systemRoutes = require("./routes/system");
const alertRoutes = require("./routes/alerts");
const safePlacesRoutes = require("./routes/safePlaces");

const app = express();

// 🔒 Security headers. CSP off: this is a JSON API, no HTML is served.
app.use(helmet({ contentSecurityPolicy: false }));
// 🛡️ Cap body size — SOS payloads are tiny; oversized bodies are abuse.
app.use(express.json({ limit: "32kb" }));

// 🌐 Trust the first proxy hop (Vercel's edge / local reverse proxies) so
// req.ip — and therefore rate limiting — sees the real client IP. Without
// this, every user shares one rate-limit bucket.
app.set("trust proxy", 1);

// 🔒 CORS — allowlisted origins only (see middleware/cors.js). With
// CORS_ALLOWED_ORIGINS unset this emits no CORS headers at all (fail
// closed): cross-site browser calls are blocked, the native app — which
// sends no Origin — is unaffected.
app.use(corsMiddleware);

// Routes (guard matrix is declared inside each route file).
app.use(systemRoutes);
app.use(alertRoutes);
app.use(safePlacesRoutes);

// 🚫 404 — every response from this API is JSON. Express's default 404
// is an HTML page ("Cannot POST /…"), which leaks framework details
// and breaks API clients expecting JSON.
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// 💥 Error handler — the catch-all for anything the routes didn't handle
// (malformed JSON from the body parser, oversized bodies, unexpected
// throws). Responses stay generic on purpose: err.message and stack
// traces can leak file paths and library internals, so details go to
// the server log ONLY. Client-caused errors keep their 4xx status
// (400 bad JSON, 413 body too large); everything else is a plain 500.
// (Express requires the 4-argument signature to treat this as an
// error handler — `next` is unused.)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 500
      ? err.status
      : 500;
  if (status === 500) {
    console.error("❌ Unhandled error:", err?.stack || err);
  } else {
    console.log(`⚠️ Rejected request (${status}):`, err?.type || err?.message);
  }
  return res.status(status).json({
    success: false,
    error: status === 500 ? "Internal server error" : "Invalid request",
  });
});

// 🚀 START SERVER (local dev only — Vercel uses api/index.js instead)
const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Server running on port " + PORT);
  });
}

module.exports = app;
