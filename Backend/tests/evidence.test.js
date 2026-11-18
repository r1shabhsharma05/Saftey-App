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

// --- Day 27: Evidence Vault (hash chain + timestamps, export) ---

const { computeChain, sha256hex, _setStorageDownload } = require("../services/evidenceVault");
const { _setDbTransport } = require("../services/supabaseDb");
const evidenceStore = require("../services/evidenceStore");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const withMockedDb = (calls) => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  _setDbTransport(async (call) => {
    calls.push(call);
    return { data: null };
  });
};

const restoreDb = () => {
  _setDbTransport(null);
  if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
  else delete process.env.SUPABASE_URL;
  if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
};

const getVault = (id, token = "test-token") =>
  fetch(`${base}/alert/${id}/evidence/vault`, { headers: { Authorization: bearer(token) } });

const getExport = (id, token = "test-token") =>
  fetch(`${base}/alert/${id}/evidence/vault/export`, { headers: { Authorization: bearer(token) } });

test("computeChain: deterministic, one changed hash changes the root, empty has no root", () => {
  const hashes = [sha256hex(Buffer.from("chunk-a")), sha256hex(Buffer.from("chunk-b"))];
  const first = computeChain(hashes);
  assert.deepEqual(computeChain(hashes), first);
  assert.equal(first.chain.length, 2);
  assert.equal(first.rootHash, first.chain[1]);
  const tampered = computeChain([hashes[0], sha256hex(Buffer.from("chunk-B"))]);
  assert.notEqual(tampered.rootHash, first.rootHash);
  // Tampering the FIRST chunk also moves the root (chain, not just last-hash).
  const tamperedFirst = computeChain([sha256hex(Buffer.from("chunk-A")), hashes[1]]);
  assert.notEqual(tamperedFirst.rootHash, first.rootHash);
  assert.deepEqual(computeChain([]), { chain: [], rootHash: null });
});

test("vault: every chunk downloads, hashes, chains — root matches the pure chain", async () => {
  const id = await createAlert();
  const calls = [];
  withMockedDb(calls);
  // Storage returns fixed bytes per path, so the hashes are known.
  _setStorageDownload(async (path) => ({ ok: true, bytes: Buffer.from(`bytes-for-${path}`) }));
  try {
    assert.equal((await registerChunk(id, { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 11, mime: "audio/mp4" })).status, 200);
    assert.equal((await registerChunk(id, { kind: "video", index: 0, storagePath: `${id}/video-0000.mp4`, bytes: 22, mime: "video/mp4" })).status, 200);
    const res = await getVault(id);
    assert.equal(res.status, 200);
    const { vault } = await res.json();
    assert.equal(vault.ok, true);
    assert.equal(vault.verified, true);
    assert.equal(vault.chunks.length, 2);
    // Vault order: audio first.
    assert.equal(vault.chunks[0].kind, "audio");
    assert.equal(vault.chunks[0].sha256, sha256hex(Buffer.from(`bytes-for-${id}/audio-0000.m4a`)));
    assert.equal(vault.chunks[1].sha256, sha256hex(Buffer.from(`bytes-for-${id}/video-0000.mp4`)));
    const { rootHash } = computeChain(vault.chunks.map((c) => c.sha256));
    assert.equal(vault.rootHash, rootHash);
    assert.equal(vault.chunks[1].chainHash, rootHash);
    assert.deepEqual(vault.missing, []);
  } finally {
    _setStorageDownload(null);
    restoreDb();
  }
});

test("vault: a chunk missing from storage fails the vault and is named", async () => {
  const id = await createAlert();
  const calls = [];
  withMockedDb(calls);
  _setStorageDownload(async (path) =>
    path.endsWith("video-0000.mp4") ? { ok: false, reason: "not_found" } : { ok: true, bytes: Buffer.from("audio-bytes") }
  );
  try {
    assert.equal((await registerChunk(id, { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 11, mime: "audio/mp4" })).status, 200);
    assert.equal((await registerChunk(id, { kind: "video", index: 0, storagePath: `${id}/video-0000.mp4`, bytes: 22, mime: "video/mp4" })).status, 200);
    const { vault } = await (await getVault(id)).json();
    assert.equal(vault.ok, false);
    assert.equal(vault.verified, false);
    assert.equal(vault.reason, "chunks_missing_from_storage");
    assert.deepEqual(vault.missing, [`${id}/video-0000.mp4`]);
    assert.equal(vault.chunks[0].verified, true);
    assert.equal(vault.chunks[1].verified, false);
    assert.equal(vault.chunks[1].sha256, null);
  } finally {
    _setStorageDownload(null);
    restoreDb();
  }
});

test("vault: storage unconfigured answers honestly instead of faking a pass", async () => {
  const id = await createAlert();
  assert.equal((await registerChunk(id, { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 11, mime: "audio/mp4" })).status, 200);
  const res = await getVault(id);
  assert.equal(res.status, 200);
  const { vault } = await res.json();
  assert.equal(vault.ok, false);
  assert.equal(vault.verified, false);
  assert.equal(vault.reason, "storage_not_configured");
  assert.equal(vault.rootHash, null);
  assert.deepEqual(vault.missing, [`${id}/audio-0000.m4a`]);
});

test("vault: zero chunks is an honest empty vault, not an error", async () => {
  const id = await createAlert();
  const { vault } = await (await getVault(id)).json();
  assert.equal(vault.ok, true);
  assert.equal(vault.verified, false);
  assert.equal(vault.rootHash, null);
  assert.deepEqual(vault.chunks, []);
  assert.deepEqual(vault.missing, []);
});

test("export: the proof carries everything needed to re-verify independently", async () => {
  const id = await createAlert();
  const calls = [];
  withMockedDb(calls);
  _setStorageDownload(async (path) => ({ ok: true, bytes: Buffer.from(`bytes-for-${path}`) }));
  try {
    assert.equal((await registerChunk(id, { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 11, mime: "audio/mp4" })).status, 200);
    const res = await getExport(id);
    assert.equal(res.status, 200);
    const { proof } = await res.json();
    assert.equal(proof.version, 1);
    assert.equal(proof.alertId, id);
    assert.equal(proof.verified, true);
    assert.equal(proof.chunks.length, 1);
    assert.equal(proof.chunks[0].storagePath, `${id}/audio-0000.m4a`);
    assert.equal(proof.chunks[0].sha256, sha256hex(Buffer.from(`bytes-for-${id}/audio-0000.m4a`)));
    assert.equal(proof.rootHash, proof.chunks[0].chainHash);
    assert.ok(proof.exportedAt);
    assert.ok(proof.verifiedAt);
  } finally {
    _setStorageDownload(null);
    restoreDb();
  }
});

test("vault + export: unknown alert 404s, another user's alert 403s, no token 401s", async () => {
  const id = await createAlert();
  assert.equal((await getVault("no-such-alert")).status, 404);
  assert.equal((await getExport("no-such-alert")).status, 404);
  assert.equal((await getVault(id, "other-token")).status, 403);
  assert.equal((await getExport(id, "other-token")).status, 403);
  assert.equal((await fetch(`${base}/alert/${id}/evidence/vault`)).status, 401);
  assert.equal((await fetch(`${base}/alert/${id}/evidence/vault/export`)).status, 401);
});

test("mirror: register upserts the evidence_chunks row, list falls back to Postgres", async () => {
  const id = await createAlert();
  const calls = [];
  const row = {
    id: `${id}:audio:0`,
    alert_id: id,
    kind: "audio",
    chunk_index: 0,
    storage_path: `${id}/audio-0000.m4a`,
    bytes: 42000,
    mime: "audio/mp4",
    uploaded_at: "2026-11-19T00:00:00.000Z",
    created_at: "2026-11-19T00:00:00.000Z",
  };
  withMockedDb(calls);
  _setDbTransport(async (call) => {
    calls.push(call);
    if (call.method === "GET") return { data: [row] };
    return { data: null };
  });
  try {
    assert.equal((await registerChunk(id, { kind: "audio", index: 0, storagePath: `${id}/audio-0000.m4a`, bytes: 42000, mime: "audio/mp4" })).status, 200);
    const upsert = calls.find((c) => c.method === "POST");
    assert.ok(upsert, "register wrote the mirror");
    assert.ok(upsert.url.includes("/rest/v1/evidence_chunks"));
    assert.equal(upsert.body.id, `${id}:audio:0`);
    // Memory cleared: the list must come back from the fake Postgres row.
    evidenceStore._clearMemory();
    const listed = await (await listChunks(id)).json();
    assert.equal(listed.chunks.length, 1);
    assert.equal(listed.chunks[0].storagePath, `${id}/audio-0000.m4a`);
    assert.equal(listed.chunks[0].uploadedAt, "2026-11-19T00:00:00.000Z");
  } finally {
    _setDbTransport(null);
    restoreDb();
  }
});
