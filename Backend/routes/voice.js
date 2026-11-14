// 🎙️ Gnani speech routes — the thin HTTP seam over services/voice.js
// (Timbre TTS + Prisma STT). The voice-trigger SOS (distress-phrase
// detection) and the spoken SOS message call these; without them the
// adapter would be dead code. Same gate as every API-key route
// (requireApiKey + trackingLimiter). No new dependencies.
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
// invalid-audio / unsupported-audio-format / audio-too-large -> 400;
// voice-rejected / voice-transport-error / voice-bad-response -> 502.
const express = require("express");
const { trackingLimiter } = require("../middleware/rateLimit");
const requireApiKey = require("../middleware/requireApiKey");
const { synthesizeSpeech, transcribeAudio } = require("../services/voice");

const router = express.Router();

const failureStatus = (reason) =>
  reason === "channel-not-configured"
    ? 503
    : reason === "empty-content" ||
        reason === "invalid-audio" ||
        reason === "unsupported-audio-format" ||
        reason === "audio-too-large"
      ? 400
      : 502;

router.post("/voice/synthesize", trackingLimiter, requireApiKey, async (req, res) => {
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
  return res.set("Content-Type", result.contentType).send(result.audio);
});

router.post(
  "/voice/transcribe",
  trackingLimiter,
  requireApiKey,
  express.raw({ limit: "2mb", type: ["audio/*", "application/octet-stream"] }),
  async (req, res) => {
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
    return res.json({ success: true, transcript: result.transcript, languageCode: result.languageCode });
  }
);

module.exports = router;
