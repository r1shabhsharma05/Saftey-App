// Voice speech tests — Gnani Vachana adapter (replaces the Day 10 Bolna
// adapter). Request shapes verified against the official gnani-vachana
// Python client (~/workspace/tmp-work/gnani-venv, v0.9.0):
//   TTS: POST https://api.vachana.ai/api/v1/tts/inference,
//        headers X-API-Key-ID + Content-Type: application/json +
//        X-API-Request-ID, body {text, model, voice, language, speed,
//        audio_config}. 200 -> raw audio bytes.
//   STT: POST https://api.vachana.ai/stt/v3, multipart form, file field
//        "audio_file" + fields language_code / format / model.
//        200 -> JSON {success, request_id, transcript, ...}.
// No live call is ever placed here: fetch is mocked, and no real key
// exists in tests. Vachana is speech APIs only — it has no phone-call
// endpoint, so sendVoiceCall honestly reports voice-call-not-supported.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GNANI_API_KEY = "test-gnani-key";

const {
  voiceStatus,
  synthesizeSpeech,
  transcribeAudio,
  sendVoiceCall,
  sendVoiceAlert,
} = require("../services/voice");

const fakeWav = () => new Uint8Array([82, 73, 70, 70]).buffer; // "RIFF"
const okTts = async () => ({ ok: true, status: 200, arrayBuffer: async () => fakeWav() });
const okStt = async (transcript = "mujhe bachao") => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, request_id: "req_test", transcript, detected_language_code: "hi-IN" }),
});

test("voiceStatus: configured only with GNANI_API_KEY, never leaks it", () => {
  assert.deepEqual(voiceStatus(), { configured: true });
  assert.ok(!JSON.stringify(voiceStatus()).includes("test-gnani-key"));
  delete process.env.GNANI_API_KEY;
  assert.deepEqual(voiceStatus(), { configured: false });
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("synthesizeSpeech: unconfigured → channel-not-configured, zero HTTP calls", async () => {
  delete process.env.GNANI_API_KEY;
  let calls = 0;
  const res = await synthesizeSpeech({
    text: "SOS",
    fetchImpl: async () => { calls += 1; return okTts(); },
  });
  assert.deepEqual(res, { ok: false, reason: "channel-not-configured" });
  assert.equal(calls, 0);
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("synthesizeSpeech: exact Gnani TTS request shape", async () => {
  const seen = [];
  const res = await synthesizeSpeech({
    text: "SOS at 28.6,77.2",
    fetchImpl: async (url, opts) => {
      seen.push({ url, opts });
      return okTts();
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.contentType, "audio/wav");
  assert.equal(res.bytes, 4);
  assert.ok(Buffer.isBuffer(res.audio));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.vachana.ai/api/v1/tts/inference");
  assert.equal(seen[0].opts.method, "POST");
  assert.equal(seen[0].opts.headers["X-API-Key-ID"], "test-gnani-key");
  assert.match(seen[0].opts.headers["X-API-Request-ID"], /^req_[0-9a-f]{12}$/);
  const body = JSON.parse(seen[0].opts.body);
  assert.equal(body.text, "SOS at 28.6,77.2");
  assert.equal(body.model, "timbre-v2.5");
  assert.equal(body.voice, "Nalini");
  assert.equal(body.language, "hi-IN");
  assert.equal(body.speed, 1.0);
  assert.deepEqual(body.audio_config, {
    sample_rate: 44100,
    encoding: "linear_pcm",
    num_channels: 1,
    sample_width: 2,
    container: "wav",
  });
});

test("synthesizeSpeech: empty text fails before any call; non-2xx and throw counted", async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return okTts(); };
  assert.deepEqual(
    await synthesizeSpeech({ text: "", fetchImpl: counting }),
    { ok: false, reason: "empty-content" }
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await synthesizeSpeech({ text: "SOS", fetchImpl: async () => ({ ok: false, status: 401 }) }),
    { ok: false, reason: "voice-rejected" }
  );
  assert.deepEqual(
    await synthesizeSpeech({
      text: "SOS",
      fetchImpl: async () => { throw new Error("down"); },
    }),
    { ok: false, reason: "voice-transport-error" }
  );
});

test("transcribeAudio: unconfigured → channel-not-configured, zero HTTP calls", async () => {
  delete process.env.GNANI_API_KEY;
  let calls = 0;
  const res = await transcribeAudio({
    audio: Buffer.from([1, 2, 3]),
    fetchImpl: async () => { calls += 1; return okStt(); },
  });
  assert.deepEqual(res, { ok: false, reason: "channel-not-configured" });
  assert.equal(calls, 0);
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("transcribeAudio: exact Gnani STT multipart shape", async () => {
  const seen = [];
  const res = await transcribeAudio({
    audio: Buffer.from([1, 2, 3, 4]),
    filename: "clip.wav",
    fetchImpl: async (url, opts) => {
      seen.push({ url, opts });
      return okStt();
    },
  });
  assert.deepEqual(res, { ok: true, transcript: "mujhe bachao", languageCode: "hi-IN" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.vachana.ai/stt/v3");
  assert.equal(seen[0].opts.method, "POST");
  assert.equal(seen[0].opts.headers["X-API-Key-ID"], "test-gnani-key");
  assert.match(seen[0].opts.headers["X-API-Request-ID"], /^req_[0-9a-f]{12}$/);
  // Multipart: fetch sets its own Content-Type with boundary — the
  // adapter must not set one by hand.
  assert.ok(!seen[0].opts.headers["Content-Type"]);
  const form = seen[0].opts.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("language_code"), "indic-auto");
  assert.equal(form.get("format"), "verbatim");
  assert.equal(form.get("model"), "prisma-v3.0");
  const file = form.get("audio_file");
  assert.equal(file.name, "clip.wav");
  assert.equal(await file.text(), "\u0001\u0002\u0003\u0004");
});

test("transcribeAudio: bad audio fails before any call; non-2xx, throw, bad JSON counted", async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return okStt(); };
  assert.deepEqual(
    await transcribeAudio({ audio: Buffer.alloc(0), fetchImpl: counting }),
    { ok: false, reason: "invalid-audio" }
  );
  assert.deepEqual(
    await transcribeAudio({ audio: "not-bytes", fetchImpl: counting }),
    { ok: false, reason: "invalid-audio" }
  );
  assert.deepEqual(
    await transcribeAudio({ audio: Buffer.from([1]), filename: "clip.txt", fetchImpl: counting }),
    { ok: false, reason: "unsupported-audio-format" }
  );
  assert.deepEqual(
    await transcribeAudio({
      audio: Buffer.alloc(2 * 1024 * 1024 + 1),
      fetchImpl: counting,
    }),
    { ok: false, reason: "audio-too-large" }
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await transcribeAudio({
      audio: Buffer.from([1]),
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    { ok: false, reason: "voice-rejected" }
  );
  assert.deepEqual(
    await transcribeAudio({
      audio: Buffer.from([1]),
      fetchImpl: async () => { throw new Error("down"); },
    }),
    { ok: false, reason: "voice-transport-error" }
  );
  assert.deepEqual(
    await transcribeAudio({
      audio: Buffer.from([1]),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    }),
    { ok: false, reason: "voice-bad-response" }
  );
});

test("sendVoiceCall: Vachana has no call leg — honest not-supported, zero HTTP calls", async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return okTts(); };
  assert.deepEqual(
    await sendVoiceCall({ to: "+919999999999", message: "SOS", fetchImpl: counting }),
    { sent: 0, failed: 1, reason: "voice-call-not-supported" }
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await sendVoiceCall({ to: "not-a-phone", message: "SOS", fetchImpl: counting }),
    { sent: 0, failed: 1, reason: "invalid-phone" }
  );
  assert.deepEqual(
    await sendVoiceCall({ to: "+919999999999", message: "", fetchImpl: counting }),
    { sent: 0, failed: 1, reason: "empty-content" }
  );
  delete process.env.GNANI_API_KEY;
  assert.deepEqual(
    await sendVoiceCall({ to: "+919999999999", message: "SOS", fetchImpl: counting }),
    { sent: 0, failed: 1, reason: "channel-not-configured" }
  );
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("sendVoiceAlert: per-contact counts, dedupe, no recipients, partial failure", async () => {
  const contacts = [
    { phone: "+919999999999", name: "Asha" },
    { phone: "+919999999999", name: "Asha dup" },
    { phone: "junk", name: "Junk" },
    { phone: "+918888888888", name: "Ravi" },
  ];
  // Every call is not-supported, so the fan-out fails 2 (deduped valid)
  // with the first result's reason — counts, not a throw.
  const res = await sendVoiceAlert({ message: "SOS", contacts, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(res.sent, 0);
  assert.equal(res.failed, 2);
  assert.equal(res.reason, "voice-call-not-supported");
  assert.deepEqual(
    await sendVoiceAlert({ message: "SOS", contacts: [] }),
    { sent: 0, failed: 1, reason: "no-voice-recipients" }
  );
  assert.deepEqual(
    await sendVoiceAlert({ message: "", contacts }),
    { sent: 0, failed: 1, reason: "empty-content" }
  );
  delete process.env.GNANI_API_KEY;
  assert.deepEqual(
    await sendVoiceAlert({ message: "SOS", contacts }),
    { sent: 0, failed: 1, reason: "channel-not-configured" }
  );
  process.env.GNANI_API_KEY = "test-gnani-key";
});
