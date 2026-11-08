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

module.exports = router;
