// 🏠 System routes — status page + health check. No auth: these answer
// "is the service up" and carry no sensitive data. Rate-limited
// (generous): unauthenticated, so they must not be a free flood target.
const express = require("express");
const { systemLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// 🏠 ROOT — friendly status page (so the URL doesn't look broken).
// No endpoint map here: listing every route (incl. the debug one) is
// free reconnaissance.
router.get("/", systemLimiter, (req, res) => {
  res.json({
    service: "SafeLife AI — Emergency Backend",
    status: "online",
    time: new Date().toISOString(),
  });
});

// ❤️ HEALTH CHECK — "is the service up", nothing more. It used to
// report the channel/config state (L1): that told anyone probing
// which integrations are wired, whether API-key enforcement is on,
// and whether the database is configured — free reconnaissance and a
// config oracle. Uptime monitors only need up/down; anything deeper
// lives behind the API key.
router.get("/health", systemLimiter, (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
  });
});

// 📱 APP VERSION (H18, force-update contract) — public, NO auth:
// the app checks this on launch to decide whether to force an
// update. Exact shape, nothing else:
//   { "minSupportedVersion": "<MIN_SUPPORTED_APP_VERSION or 1.0.0>",
//     "latestVersion": "<LATEST_APP_VERSION or = min>" }
// Env is read per request so a redeploy picks new values up with
// no code change. No auth, no user data, no config oracle —
// version numbers are public by design.
router.get("/version", systemLimiter, (req, res) => {
  const min = process.env.MIN_SUPPORTED_APP_VERSION || "1.0.0";
  res.json({
    minSupportedVersion: min,
    latestVersion: process.env.LATEST_APP_VERSION || min,
  });
});

module.exports = router;
