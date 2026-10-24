// 🏠 System routes — status page + health check. No auth: these answer
// "is the service up" and carry no sensitive data.
const express = require("express");
const { telegramStatus } = require("../services/telegram");
const { getCacheStats } = require("../services/safePlaces");

const router = express.Router();

// 🏠 ROOT — friendly status page (so the URL doesn't look broken)
router.get("/", (req, res) => {
  res.json({
    service: "SafeLife AI — Emergency Backend",
    status: "online",
    time: new Date().toISOString(),
    // No endpoint map here: this route is unauthenticated, and listing
    // every route (incl. the debug one) is free reconnaissance.
  });
});

// ❤️ HEALTH CHECK — reports whether the service is CONFIGURED to do its
// job (Telegram wired? API-key enforcement on? cache alive?). It does NOT
// probe Telegram/Overpass per request: health checks fire every few
// seconds from uptime monitors, and each probe would burn shared upstream
// quota and add latency. "Green" here means: up + configured.
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
    config: {
      telegram: telegramStatus(),
      apiKeyEnforced: Boolean(process.env.API_SECRET),
    },
    safePlacesCache: getCacheStats(),
  });
});

module.exports = router;
