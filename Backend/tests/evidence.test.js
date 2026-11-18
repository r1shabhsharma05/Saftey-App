// 🧪 Evidence chunk registry — SafeLife 2.0 Day 26 (stealth
// recording, plan §6 D26, §3 F5).
//
// POST /alert/:id/evidence/chunks registers one uploaded 5 s chunk
// (metadata only — the bytes live in Supabase Storage); GET lists
// the alert's chunks in vault order (audio, then video, by index).
// Registering the same chunk twice is an idempotent 200, so the
// app's resume path can safely re-register after a lost response.
//
// Runs the REAL Express app over HTTP with every channel
// unconfigured, so each SOS honestly answers 502 (failed state) and
// the assert is on the registry, not on delivery.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d26-evidence-secret";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_TEMPLATE_LANGUAGE",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
  "BOLNA_API_KEY",
  "BOLNA_AGENT_ID",
  "QSTASH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "PUBLIC_BASE_URL",
  "VERCEL_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  delete process.env[v];
}

const app = require("../server");
const { setupJwtAuth, teardownJwtAuth, bearer } = require("./jwtAuth");
setupJwtAuth({
  "test-token": { id: "test-user", email: "test@example.com" },
  "other-token": { id: "other-user", email: "other@example.com" },
});

const SOS_BODY = {
  lat: 28.6139,
  lng: 77.209,
  name: "Evidence User",
  phone: "0000000000",
  battery: "42%",
  status: "Stationary",
  nearestStation: "Evidence Station",
  contacts: [],
};

let server;
let base;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  teardownJwtAuth();
  await new Promise((resolve) => server.close(resolve));
});

const createAlert = async (token = "test-token") => {
  const res = await fetch(`${base}/alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: bearer(token) },
    body: JSON.stringify(SOS_BODY),
  });
  assert.equal(res.status, 502, "channels down → honest 502, not a fake success");
  const data = await res.json();
  assert.ok(data.alertId, "a failed alert still carries its id");
  return data.alertId;
};

const registerChunk = (id, body, token = "test-token") =>
  fetch(`${base}/alert/${id}/evidence/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: bearer(token) },
    body: JSON.stringify(body),
  });

const listChunks = (id, token = "test-token") =>
  fetch(`${base}/alert/${id}/evidence/chunks`, { headers: { Authorization: bearer(token) } });

test("register + list: audio chunk lands, vault order holds", async () => {
  const id = await createAlert();
  const res = await registerChunk(id, {
    kind: "audio",
    index: 0,
    storagePath: `${id}/audio-0000.m4a`,
    bytes: 42000,
    mime: "audio/mp4",
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.created, true);
  assert.equal(data.chunk.index, 0);
  const list = await listChunks(id);
  assert.equal(list.status, 200);
  const listed = await list.json();
  assert.equal(listed.chunks.length, 1);
  assert.equal(listed.chunks[0].storagePath, `${id}/audio-0000.m4a`);
});

test("re-registering the same chunk is an idempotent 200, not a duplicate", async () => {
  const id = await createAlert();
  const body = { kind: "video", index: 2, storagePath: `${id}/video-0002.mp4`, bytes: 1500000, mime: "video/mp4" };
  assert.equal((await registerChunk(id, body)).status, 200);
  const again = await registerChunk(id, body);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).created, false);
  const listed = await (await listChunks(id)).json();
  assert.equal(listed.chunks.length, 1);
});

test("bad kind, bad path, bad bytes all 400 — the vault never gets a bad row", async () => {
  const id = await createAlert();
  const good = { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 42000, mime: "audio/mp4" };
  assert.equal((await registerChunk(id, { ...good, kind: "photo" })).status, 400);
  assert.equal((await registerChunk(id, { ...good, storagePath: `other/${id}/audio-0000.m4a` })).status, 400);
  assert.equal((await registerChunk(id, { ...good, storagePath: `${id}/audio-0001.m4a` })).status, 400);
  assert.equal((await registerChunk(id, { ...good, bytes: 0 })).status, 400);
  assert.equal((await registerChunk(id, { ...good, bytes: 26 * 1024 * 1024 })).status, 400);
  assert.equal((await registerChunk(id, { ...good, mime: "text/plain" })).status, 400);
  const listed = await (await listChunks(id)).json();
  assert.equal(listed.chunks.length, 0);
});

test("unknown alert 404s, another user's alert 403s, no token 401s", async () => {
  const id = await createAlert();
  assert.equal((await registerChunk("no-such-alert", { kind: "audio", index: 0, storagePath: "no-such-alert/audio-0000.m4a", bytes: 1, mime: "audio/mp4" })).status, 404);
  const forbidden = await registerChunk(
    id,
    { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 42, mime: "audio/mp4" },
    "other-token"
  );
  assert.equal(forbidden.status, 403);
  const noAuth = await fetch(`${base}/alert/${id}/evidence/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 42, mime: "audio/mp4" }),
  });
  assert.equal(noAuth.status, 401);
  const listForbidden = await listChunks(id, "other-token");
  assert.equal(listForbidden.status, 403);
});
