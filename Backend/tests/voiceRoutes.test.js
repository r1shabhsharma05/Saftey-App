// Gnani speech route tests — real Express app over HTTP. The global
// fetch is stubbed in this process (Gnani URLs get canned responses,
// everything else delegates to the real fetch), so no request ever
// leaves the VM and no real key exists in tests.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "voice-route-secret";
process.env.GNANI_API_KEY = "test-gnani-key";

const realFetch = globalThis.fetch;
const gnaniCalls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://api.vachana.ai/api/v1/tts/inference")) {
    gnaniCalls.push({ kind: "tts", url: u, opts });
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([82, 73, 70, 70]).buffer };
  }
  if (u.startsWith("https://api.vachana.ai/stt/v3")) {
    gnaniCalls.push({ kind: "stt", url: u, opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, request_id: "req_test", transcript: "mujhe bachao", detected_language_code: "hi-IN" }),
    };
  }
  return realFetch(url, opts);
};

const app = require("../server");

const KEY = "voice-route-secret";
let server;
let base;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (path, body, key, contentType) =>
  realFetch(`${base}${path}`, {
    method: "POST",
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(key ? { "x-api-key": key } : {}),
    },
    body,
  });

test("POST /voice/synthesize without key → 401; unconfigured → 503", async () => {
  const noKey = await post("/voice/synthesize", JSON.stringify({ text: "SOS" }), null, "application/json");
  assert.equal(noKey.status, 401);
  delete process.env.GNANI_API_KEY;
  const unconfigured = await post("/voice/synthesize", JSON.stringify({ text: "SOS" }), KEY, "application/json");
  assert.equal(unconfigured.status, 503);
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("POST /voice/synthesize with key → 200 audio/wav via Gnani TTS", async () => {
  gnaniCalls.length = 0;
  const res = await post("/voice/synthesize", JSON.stringify({ text: "SOS at 28.6,77.2" }), KEY, "application/json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /audio\/wav/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from([82, 73, 70, 70]));
  assert.equal(gnaniCalls.length, 1);
  assert.equal(gnaniCalls[0].kind, "tts");
  assert.equal(gnaniCalls[0].opts.headers["X-API-Key-ID"], "test-gnani-key");
  assert.equal(JSON.parse(gnaniCalls[0].opts.body).text, "SOS at 28.6,77.2");
});

test("POST /voice/synthesize empty text → 400, no Gnani call", async () => {
  gnaniCalls.length = 0;
  const res = await post("/voice/synthesize", JSON.stringify({ text: "" }), KEY, "application/json");
  assert.equal(res.status, 400);
  assert.equal(gnaniCalls.length, 0);
});

test("POST /voice/transcribe without key → 401; unconfigured → 503", async () => {
  const noKey = await post("/voice/transcribe", Buffer.from([1, 2, 3]), null, "audio/wav");
  assert.equal(noKey.status, 401);
  delete process.env.GNANI_API_KEY;
  const unconfigured = await post("/voice/transcribe", Buffer.from([1, 2, 3]), KEY, "audio/wav");
  assert.equal(unconfigured.status, 503);
  process.env.GNANI_API_KEY = "test-gnani-key";
});

test("POST /voice/transcribe with key → 200 transcript via Gnani STT", async () => {
  gnaniCalls.length = 0;
  const res = await post("/voice/transcribe?filename=clip.wav", Buffer.from([1, 2, 3, 4]), KEY, "audio/wav");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, transcript: "mujhe bachao", languageCode: "hi-IN" });
  assert.equal(gnaniCalls.length, 1);
  assert.equal(gnaniCalls[0].kind, "stt");
  const form = gnaniCalls[0].opts.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("language_code"), "indic-auto");
  assert.equal(form.get("model"), "prisma-v3.0");
  assert.equal(form.get("audio_file").name, "clip.wav");
});

test("POST /voice/transcribe empty body → 400; bad extension → 400, no Gnani call", async () => {
  gnaniCalls.length = 0;
  const empty = await post("/voice/transcribe", Buffer.alloc(0), KEY, "audio/wav");
  assert.equal(empty.status, 400);
  const badExt = await post("/voice/transcribe?filename=clip.txt", Buffer.from([1]), KEY, "audio/wav");
  assert.equal(badExt.status, 400);
  assert.equal(gnaniCalls.length, 0);
});
