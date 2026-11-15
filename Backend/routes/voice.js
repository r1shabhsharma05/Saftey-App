// 🎙️ Gnani speech routes — the thin HTTP seam over services/voice.js
// (Timbre TTS + Prisma STT). The voice-trigger SOS (distress-phrase
// detection) and the spoken SOS message call these; without them the
// adapter would be dead code.
//
// Run-2 2.1/8.1: JWT-only auth (requireUser) + the
// voice routes' OWN limiter (voiceLimiter, 10/min per IP — no longer
// the shared 60/min tracking bucket) + a per-account DAILY Gnani
// counter (50/day, services/voice.js). A Gnani call that reaches the
// provider counts against the quota, whether it succeeds or is
// rejected there.
//
// POST /voice/synthesize — JSON {text, voice?, language?} -> raw
//   audio/wav bytes (the SOS message, spoken). The global JSON limit
//   is 32kb, which is plenty for a text body.
// POST /voice/transcribe — RAW audio bytes in the body (base64 would
//   413 against the global 32kb JSON limit), Content-Type audio/* or
//   application/octet-stream, ?filename=clip.wav&languageCode=indic-auto
//   -> {success, transcript, languageCode}. Clips are capped at 2 MB
//   decoded (Prisma takes <= 30 s per request).
// Reason -> HTTP: channel-not-configured -> 503; empty-content /
// invalid-audio / unsupported-audio-format / audio-too-large /
// unsupported-voice / unsupported-language -> 400;
// voice-rejected / voice-transport-error / voice-bad-response -> 502.
const express = require("express");
const { voiceLimiter } = require("../middleware/rateLimit");
const { requireUser } = require("../middleware/requireUser");
const {
  synthesizeSpeech,
  transcribeAudio,
  gnaniQuotaKey,
  checkGnaniQuota,
  recordGnaniCall,
} = require("../services/voice");

const router = express.Router();

const failureStatus = (reason) =>
  reason === "channel-not-configured"
    ? 503
    : reason === "empty-content" ||
        reason === "invalid-audio" ||
        reason === "unsupported-audio-format" ||
        reason === "audio-too-large" ||
        reason === "unsupported-voice" ||
        reason === "unsupported-language"
      ? 400
      : 502;

// 8.1: the per-account daily Gnani counter (shared Supabase table
// gnani_daily_usage, services/voice.js — fail-open to memory when
// the DB is down). Runs BEFORE the provider call; a call that
// reaches Gnani (success or provider rejection) counts.
// Validation/config failures do not.
const checkQuota = async (req, res) => {
  const quota = await checkGnaniQuota(gnaniQuotaKey(req));
  if (quota.allowed) return quota;
  res.status(429).json({
    success: false,
    error: "Daily voice quota reached — please try again tomorrow",
  });
  return null;
};

const countIfSpent = async (req, result) => {
  if (result.ok || result.reason === "voice-rejected") {
    await recordGnaniCall(gnaniQuotaKey(req));
  }
};

router.post("/voice/synthesize", voiceLimiter, requireUser, async (req, res) => {
  if (!(await checkQuota(req, res))) return;
  const result = await synthesizeSpeech({
    text: typeof req.body?.text === "string" ? req.body.text : "",
    voice: req.body?.voice,
    language: req.body?.language,
  });
  if (!result.ok) {
    return res.status(failureStatus(result.reason)).json({
      success: false,
      error:
        result.reason === "channel-not-configured"
          ? "Voice not configured — GNANI_API_KEY is not set"
          : result.reason,
    });
  }
  await countIfSpent(req, result);
  return res.set("Content-Type", result.contentType).send(result.audio);
});

router.post(
  "/voice/transcribe",
  voiceLimiter,
  requireUser,
  express.raw({ limit: "2mb", type: ["audio/*", "application/octet-stream"] }),
  async (req, res) => {
    if (!(await checkQuota(req, res))) return;
    const audio = Buffer.isBuffer(req.body) ? req.body : null;
    const result = await transcribeAudio({
      audio: audio || Buffer.alloc(0),
      filename: typeof req.query.filename === "string" ? req.query.filename : undefined,
      languageCode: typeof req.query.languageCode === "string" ? req.query.languageCode : undefined,
    });
    if (!result.ok) {
      return res.status(failureStatus(result.reason)).json({
        success: false,
        error:
          result.reason === "channel-not-configured"
            ? "Voice not configured — GNANI_API_KEY is not set"
            : result.reason,
      });
    }
    await countIfSpent(req, result);
    return res.json({ success: true, transcript: result.transcript, languageCode: result.languageCode });
  }
);

module.exports = router;
