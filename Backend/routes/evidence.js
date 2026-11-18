// 📼 Evidence chunk registry routes — SafeLife 2.0 Day 26 (stealth
// recording, plan §6 D26, §3 F5).
//
// POST /alert/:id/evidence/chunks — the app registers each 5 s
// chunk AFTER uploading its bytes to Supabase Storage. The server
// stores metadata only (kind, index, storage path, bytes, mime) —
// it never receives the recording itself.
//
// Guard matrix: JWT-gated (requireUser) + owner-only (owns — a
// chunk registry is per-victim evidence, never cross-user) +
// trackingLimiter (60/min: 2 streams × 12 chunks/min leaves headroom
// for re-registers). Validation is strict because the registry is
// D27's hash-chain input: a bad row today is a broken vault
// tomorrow. Re-registering the same chunk is a 200 with the stored
// row, not an error — the app's resume path depends on it.
const express = require("express");
const { requireUser, owns } = require("../middleware/requireUser");
const { trackingLimiter } = require("../middleware/rateLimit");
const { isFiniteNumber, toNumber, sanitizeText } = require("../lib/validate");
const { audit } = require("../services/audit");
const alertStore = require("../services/alertStore");
const evidenceStore = require("../services/evidenceStore");

const router = express.Router();

const EVIDENCE_KINDS = new Set(["audio", "video"]);
const EVIDENCE_MIMES = new Set(["audio/mp4", "video/mp4", "video/quicktime"]);
const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

// <alertId>/<kind>-NNNN.(m4a|mp4|mov) — the app builds it with
// utils/evidenceChunks.ts; the server re-checks it rather than
// trusting the client, so a crafted path can never point the vault
// at another alert's folder or outside the bucket.
const isValidEvidencePath = (path, alertId, kind, index) => {
  if (typeof path !== "string" || typeof alertId !== "string" || !alertId) return false;
  if (!/^[A-Za-z0-9-]+$/.test(alertId)) return false;
  const ext = kind === "audio" ? "m4a" : "(?:mp4|mov)";
  return new RegExp(`^${alertId}/${kind}-${String(index).padStart(4, "0")}\\.${ext}$`).test(path);
};

const loadOwnedAlert = async (req, res) => {
  const alert = await alertStore.get(req.params.id);
  if (!alert) {
    res.status(404).json({ success: false, error: "Alert not found" });
    return null;
  }
  if (!owns(req, alert.ownerId)) {
    res.status(403).json({ success: false, error: "Not your alert" });
    return null;
  }
  return alert;
};

router.post("/alert/:id/evidence/chunks", trackingLimiter, requireUser, async (req, res) => {
  const alert = await loadOwnedAlert(req, res);
  if (!alert) return;

  const kind = typeof req.body.kind === "string" ? req.body.kind : "";
  const index = isFiniteNumber(req.body.index) ? toNumber(req.body.index) : NaN;
  const storagePath = sanitizeText(req.body.storagePath, 200);
  const bytes = isFiniteNumber(req.body.bytes) ? toNumber(req.body.bytes) : NaN;
  const mime = typeof req.body.mime === "string" ? req.body.mime : "";

  if (!EVIDENCE_KINDS.has(kind)) {
    return res.status(400).json({ success: false, error: "kind must be audio or video" });
  }
  if (!Number.isInteger(index) || index < 0 || index >= evidenceStore.MAX_CHUNKS_PER_ALERT) {
    return res.status(400).json({ success: false, error: "index must be an integer in range" });
  }
  if (!isValidEvidencePath(storagePath, alert.id, kind, index)) {
    return res.status(400).json({ success: false, error: "storagePath does not match this alert and chunk" });
  }
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_CHUNK_BYTES) {
    return res.status(400).json({ success: false, error: "bytes must be a positive integer within the chunk cap" });
  }
  if (!EVIDENCE_MIMES.has(mime)) {
    return res.status(400).json({ success: false, error: "mime is not an evidence type" });
  }

  const { chunk, created, full } = evidenceStore.register(alert.id, { kind, index, storagePath, bytes, mime });
  if (full) {
    return res.status(429).json({ success: false, error: "Evidence registry is full for this alert" });
  }
  if (created) {
    audit("evidence.chunk.registered", {
      userId: req.user.id,
      ip: req.ip,
      meta: { alertId: alert.id, kind, index, bytes },
    });
  }
  return res.status(200).json({ success: true, created, chunk: evidenceStore.toPublic(chunk) });
});

router.get("/alert/:id/evidence/chunks", trackingLimiter, requireUser, async (req, res) => {
  const alert = await loadOwnedAlert(req, res);
  if (!alert) return;
  return res.status(200).json({ success: true, chunks: evidenceStore.list(alert.id) });
});

module.exports = router;
