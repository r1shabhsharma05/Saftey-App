// 🛡️ Admin basics — SafeLife 2.0 Day 23 (plan §6 D23).
//
// The audit trail is write-only today (stdout + Postgres mirror);
// this is the read-back: recent audit events, newest first, for the
// phone's owner to review. Same gate as every mutating route
// (requireApiKey — no separate admin role exists in this codebase).
// When Supabase is unconfigured the trail lives only on stdout and
// cannot be listed — the route says so (503) instead of faking rows.
const express = require("express");
const { trackingLimiter } = require("../middleware/rateLimit");
const requireApiKey = require("../middleware/requireApiKey");
const { dbStatus, dbListRecent } = require("../services/supabaseDb");

const router = express.Router();

router.get("/admin/audit", trackingLimiter, requireApiKey, async (req, res) => {
  if (!dbStatus().configured) {
    return res.status(503).json({
      success: false,
      error: "Audit store not configured — audit events are only on stdout",
    });
  }
  const { ok, rows, reason } = await dbListRecent("audit_events", { limit: req.query.limit });
  if (!ok) {
    return res.status(502).json({ success: false, error: `Audit read failed: ${reason}` });
  }
  res.json({ success: true, source: "postgres", events: rows });
});

module.exports = router;
