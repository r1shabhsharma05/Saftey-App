// 🛡️ Admin basics — SafeLife 2.0 Day 23 (plan §6 D23).
//
// The audit trail is write-only today (stdout + Postgres mirror);
// this is the read-back: recent audit events, newest first, for the
// phone's owner to review.
//
// Run-2 3.3: JWT ONLY + an allowlisted admin id — no shared-key
// fallback. ADMIN_USER_IDS is a comma-separated env list of Supabase
// user ids; when it is UNSET, nobody is an admin and every read is a
// 403. The ids are set in the hosting dashboard, never from a client
// claim. Run-2 5.6: failures answer a generic message; the upstream
// reason is logged server-side only. Run-2 10.5: every read is itself
// audited (admin.audit_read).
// When Supabase is unconfigured the trail lives only on stdout and
// cannot be listed — the route says so (503) instead of faking rows.
const express = require("express");
const { trackingLimiter } = require("../middleware/rateLimit");
const { requireUser } = require("../middleware/requireUser");
const { dbStatus, dbListRecent } = require("../services/supabaseDb");
const { audit } = require("../services/audit");

const router = express.Router();

const adminIds = () =>
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

router.get("/admin/audit", trackingLimiter, requireUser, async (req, res) => {
  if (!adminIds().includes(req.user.id)) {
    audit("admin.audit_denied", { userId: req.user.id, ip: req.ip, meta: { userId: req.user.id } });
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  if (!dbStatus().configured) {
    return res.status(503).json({
      success: false,
      error: "Audit store not configured — audit events are only on stdout",
    });
  }
  const { ok, rows, reason } = await dbListRecent("audit_events", { limit: req.query.limit });
  if (!ok) {
    console.log("❌ Audit read failed:", reason);
    // Run-3 fix round 3 (F-10.5a): a failed read is an audit event
    // too — previously only console.log'd, invisible in the trail.
    audit("admin.audit_read_failed", { userId: req.user.id, ip: req.ip, meta: { reason } });
    return res.status(502).json({ success: false, error: "Audit read failed — please try again" });
  }
  audit("admin.audit_read", { userId: req.user.id, ip: req.ip, meta: { limit: req.query.limit } });
  res.json({ success: true, source: "postgres", events: rows });
});

module.exports = router;
