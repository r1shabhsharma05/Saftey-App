// 🎙️ Voice speech service — Gnani Vachana (Prisma STT + Timbre TTS).
// Replaces the Day 10 Bolna adapter (2026-11-14, Gnani challenge:
// the project must be built on Gnani's own speech models).
//
// Provider facts, verified against the official gnani-vachana Python
// client (~/workspace/tmp-work/gnani-venv, v0.9.0) — NOT docs hearsay:
//   TTS: POST https://api.vachana.ai/api/v1/tts/inference, headers
//        X-API-Key-ID + Content-Type: application/json +
//        X-API-Request-ID, body {text, model, voice, language, speed,
//        audio_config}. 200 -> raw audio bytes.
//   STT: POST https://api.vachana.ai/stt/v3, multipart form, file field
//        "audio_file" + fields language_code / format / model.
//        200 -> JSON {success, request_id, transcript, ...}.
// The key is GNANI_API_KEY (the client itself falls back to it).
//
// What Vachana is NOT: it has no phone-call / telephony endpoint —
// the package ships only stt + tts, and no Gnani outbound-call REST
// API is documented anywhere public (Gnani Agents is a console
// builder product). So the old sendVoiceCall phone leg CANNOT be
// re-pointed at Gnani: it honestly reports voice-call-not-supported
// instead of faking a call or guessing a calls URL. The escalation
// ladder already treats a failed voice step as a counted failure and
// continues, so this is honest telemetry, not a silent no-op. The
// outbound-call leg needs the Agent Builder console agent + its calls
// API — a separate, unverified piece. What this adapter DOES give the
// app, live: Timbre TTS for the spoken SOS message, and Prisma STT
// for the voice-trigger SOS (distress-phrase detection, Phase 1) —
// both exposed as thin routes in routes/voice.js.
//
// Config (server-side only, never in the app): GNANI_API_KEY. Without
// it, every call honestly reports channel-not-configured. Phones are
// validated, deduplicated, and never logged in full; transcripts and
// synthesised text are never logged either.
const { normalizePhone } = require("./sms");

const GNANI_BASE_URL = "https://api.vachana.ai";
const TTS_URL = `${GNANI_BASE_URL}/api/v1/tts/inference`;
const STT_URL = `${GNANI_BASE_URL}/stt/v3`;

// Live-verified 2026-11-14: Hindi TTS, timbre-v2.5, voice Nalini.
const TTS_MODEL = "timbre-v2.5";
const TTS_VOICE = "Nalini";
const TTS_LANGUAGE = "hi-IN";
const TTS_AUDIO_CONFIG = {
  sample_rate: 44100,
  encoding: "linear_pcm",
  num_channels: 1,
  sample_width: 2,
  container: "wav",
};

// Prisma v3.0 + indic-auto: the multilingual model, right for
// Hinglish distress phrases ("help me" / "mujhe bachao"). Audio is
// limited to 30 s per request — 2 MB decoded is a generous cap for
// a 30 s clip at telephony rates.
const STT_MODEL = "prisma-v3.0";
const STT_LANGUAGE = "indic-auto";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const STT_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"]);
const STT_MIME = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

const voiceConfig = () => ({
  apiKey: process.env.GNANI_API_KEY || "",
});

// Config-status for callers — booleans only, never secret values.
const voiceStatus = () => {
  const { apiKey } = voiceConfig();
  return { configured: Boolean(apiKey) };
};

// Same request-id shape as the Python client (req_<12 hex>).
const newRequestId = () =>
  `req_${require("node:crypto").randomUUID().replace(/-/g, "").slice(0, 12)}`;

const gnaniHeaders = (apiKey) => ({
  "X-API-Key-ID": apiKey,
  "X-API-Request-ID": newRequestId(),
});

// Synthesise speech with Timbre TTS. Never throws: every failure mode
// returns a counted failure with a reason. Returns the raw audio bytes
// — the caller decides what to do with them (play, store, attach).
const synthesizeSpeech = async ({ text, voice, language, fetchImpl = fetch } = {}) => {
  const { apiKey } = voiceConfig();
  if (!apiKey) {
    return { ok: false, reason: "channel-not-configured" };
  }
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, reason: "empty-content" };
  }
  try {
    const res = await fetchImpl(TTS_URL, {
      method: "POST",
      headers: {
        ...gnaniHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, 1000),
        model: TTS_MODEL,
        voice: typeof voice === "string" && voice.trim() ? voice.trim() : TTS_VOICE,
        language: typeof language === "string" && language.trim() ? language.trim() : TTS_LANGUAGE,
        speed: 1.0,
        audio_config: TTS_AUDIO_CONFIG,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.log("❌ Gnani TTS rejected synthesis: HTTP", res.status);
      return { ok: false, reason: "voice-rejected" };
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio, contentType: "audio/wav", bytes: audio.length };
  } catch (err) {
    console.log("❌ Gnani TTS failed:", err.name || "transport-error");
    return { ok: false, reason: "voice-transport-error" };
  }
};

const audioExtension = (filename) => {
  const m = /(?:\.)([A-Za-z0-9]+)$/.exec(typeof filename === "string" ? filename : "");
  return m ? `.${m[1].toLowerCase()}` : "";
};

// Transcribe audio with Prisma STT. Never throws. `audio` is a Buffer
// (or Uint8Array); `filename` only decides the multipart file name
// and the validated extension — it is never trusted as a path.
const transcribeAudio = async ({ audio, filename, languageCode, fetchImpl = fetch } = {}) => {
  const { apiKey } = voiceConfig();
  if (!apiKey) {
    return { ok: false, reason: "channel-not-configured" };
  }
  if ((!Buffer.isBuffer(audio) && !(audio instanceof Uint8Array)) || audio.length === 0) {
    return { ok: false, reason: "invalid-audio" };
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    return { ok: false, reason: "audio-too-large" };
  }
  const name = typeof filename === "string" && filename.trim() ? filename.trim() : "clip.wav";
  const ext = audioExtension(name);
  if (!STT_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "unsupported-audio-format" };
  }
  const form = new FormData();
  form.append(
    "language_code",
    typeof languageCode === "string" && languageCode.trim() ? languageCode.trim() : STT_LANGUAGE
  );
  form.append("format", "verbatim");
  form.append("model", STT_MODEL);
  // No manual Content-Type: fetch sets the multipart boundary itself.
  form.append("audio_file", new Blob([audio], { type: STT_MIME[ext] }), name);
  try {
    const res = await fetchImpl(STT_URL, {
      method: "POST",
      headers: gnaniHeaders(apiKey),
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.log("❌ Gnani STT rejected transcription: HTTP", res.status);
      return { ok: false, reason: "voice-rejected" };
    }
    const data = await res.json().catch(() => null);
    if (!data || typeof data.transcript !== "string") {
      return { ok: false, reason: "voice-bad-response" };
    }
    return {
      ok: true,
      transcript: data.transcript,
      languageCode:
        typeof data.detected_language_code === "string" ? data.detected_language_code : STT_LANGUAGE,
    };
  } catch (err) {
    console.log("❌ Gnani STT failed:", err.name || "transport-error");
    return { ok: false, reason: "voice-transport-error" };
  }
};

// One voice call to one recipient — KEPT for interface parity with the
// Bolna adapter (alerts.js / escalation.js call it through
// sendVoiceAlert and already handle a failed voice step as a counted
// failure). Vachana provides speech synthesis and recognition, NOT
// telephony, so no HTTP call is made and the honest reason is
// voice-call-not-supported. `name` and `fetchImpl` stay in the
// signature so callers don't change; neither is used.
const sendVoiceCall = async ({ to, name, message, fetchImpl = fetch } = {}) => {
  void name;
  void fetchImpl;
  if (!voiceStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  const recipient = normalizePhone(to);
  if (!recipient) {
    return { sent: 0, failed: 1, reason: "invalid-phone" };
  }
  if (typeof message !== "string" || message.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  return { sent: 0, failed: 1, reason: "voice-call-not-supported" };
};

// Voice fan-out over the alert's emergency contacts: one call per
// distinct valid phone. Counts are per contact. No full phone number
// ever leaves this module — logs carry counts only.
const sendVoiceAlert = async ({ message, contacts = [], fetchImpl = fetch } = {}) => {
  if (!voiceStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  if (typeof message !== "string" || message.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  const seen = new Set();
  const targets = [];
  for (const c of (Array.isArray(contacts) ? contacts : []).slice(0, 10)) {
    const phone = normalizePhone(c?.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    targets.push({ phone, name: typeof c?.name === "string" ? c.name : "" });
  }
  if (targets.length === 0) {
    return { sent: 0, failed: 1, reason: "no-voice-recipients" };
  }
  const results = await Promise.all(
    targets.map((t) => sendVoiceCall({ to: t.phone, name: t.name, message, fetchImpl }))
  );
  const sent = results.reduce((n, r) => n + r.sent, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const out = { sent, failed };
  if (sent === 0) {
    out.reason = results[0].reason || "voice-failed";
  }
  return out;
};

module.exports = {
  voiceConfig,
  voiceStatus,
  synthesizeSpeech,
  transcribeAudio,
  sendVoiceCall,
  sendVoiceAlert,
};
