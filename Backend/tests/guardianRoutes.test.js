// 🛡️ Guardian routes tests — SafeLife 2.0 Day 19 (plan §6 D19).
// Real Express app over HTTP (simulation-suite pattern). Every external
// dependency is unconfigured, so no message can leave this process —
// in particular SMS is unconfigured, so request-code must honestly
// 503 (verification-unavailable) instead of pretending a code was
// sent. The verify path is exercised over HTTP with a code issued
// through the in-process service seam (the same code the route would
// hand to the SMS adapter) — the code itself never travels in any
// response, and a test asserts exactly that.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = ["d19", "route", "secret"].join("-");
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
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
const guardianStore = require("../services/guardianStore");
const { issueCode } = require("../services/guardian");

const KEY = "d19-route-secret";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const HEADERS = { "Content-Type": "application/json", "x-api-key": KEY };

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
beforeEach(() => guardianStore._clearMemory());

const post = (path, body, headers = HEADERS) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const get = (path, headers = HEADERS) =>
  fetch(`${base}${path}`, { headers }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

const register = (overrides = {}) =>
  post("/guardians", {
    userId: "user-1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    role: "family",
    ...overrides,
  });

test("POST /guardians: no key → 401; wrong key → 401", async () => {
  const noKey = await post("/guardians", { userId: "u", name: "N", phone: "+919876543210", role: "family" }, { "Content-Type": "application/json" });
  assert.equal(noKey.status, 401);
  const badKey = await post("/guardians", { userId: "u", name: "N", phone: "+919876543210", role: "family" }, { ...HEADERS, "x-api-key": "wrong" });
  assert.equal(badKey.status, 401);
});

test("POST /guardians: valid → 200 pending guardian, public shape only (no code material)", async () => {
  const { status, body } = await register();
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.guardian.state, "pending");
  assert.equal(body.guardian.available, false);
  assert.equal(body.guardian.phone, "+919876543210");
  assert.equal("verification" in body.guardian, false);
  assert.equal(JSON.stringify(body).includes("hash"), false);
});

test("POST /guardians: bad phone / role / name / userId → 400", async () => {
  assert.equal((await register({ phone: "junk" })).status, 400);
  assert.equal((await register({ role: "police" })).status, 400);
  assert.equal((await register({ name: "   " })).status, 400);
  assert.equal((await register({ userId: "" })).status, 400);
});

test("POST /guardians: same phone twice → same record, no duplicate (name updates while pending)", async () => {
  const first = await register();
  const second = await register({ name: "Ramesh K", role: "friend" });
  assert.equal(second.status, 200);
  assert.equal(second.body.guardian.id, first.body.guardian.id);
  assert.equal(second.body.guardian.name, "Ramesh K");
  assert.equal(second.body.guardian.state, "pending");
  assert.equal(guardianStore._size(), 1);
});

test("POST /guardians: same phone, different userId → 409 (cannot claim another user's guardian record)", async () => {
  const first = await register();
  assert.equal(first.status, 200);
  const hijack = await register({ userId: "user-2", name: "Someone Else" });
  assert.equal(hijack.status, 409);
  assert.match(hijack.body.error, /already registered/);
});

test("POST /guardians/:id/request-code: SMS unconfigured → 503 verification-unavailable, no code issued", async () => {
  const { body } = await register();
  const id = body.guardian.id;
  const res = await post(`/guardians/${id}/request-code`, {});
  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.sent, false);
  assert.equal(res.body.reason, "channel-not-configured");
  // Nothing was issued: a verify now must say no code is pending.
  const verify = await post(`/guardians/${id}/verify`, { code: "123456" });
  assert.equal(verify.status, 409);
  assert.match(verify.body.error, /No verification code pending/);
});

test("POST /guardians/:id/request-code + /verify: unknown id → 404", async () => {
  assert.equal((await post(`/guardians/${UNKNOWN}/request-code`, {})).status, 404);
  assert.equal((await post(`/guardians/${UNKNOWN}/verify`, { code: "123456" })).status, 404);
  assert.equal((await post(`/guardians/${UNKNOWN}/availability`, { available: true })).status, 404);
  assert.equal((await get(`/guardian/${UNKNOWN}`)).status, 404);
});

// Registers a guardian and issues a code through the in-process
// service seam — the same code the route would hand to the SMS
// adapter when it is configured. The code never enters a response.
const registeredWithCode = async () => {
  const { body } = await register();
  const guardian = await guardianStore.get(body.guardian.id);
  const { code } = issueCode(guardian);
  guardianStore.save(guardian);
  return { id: guardian.id, code, hash: guardian.verification.hash };
};

test("POST /guardians/:id/verify: issued code → 200 verified; response carries no code or hash", async () => {
  const { id, code, hash } = await registeredWithCode();
  const res = await post(`/guardians/${id}/verify`, { code });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.guardian.state, "verified");
  assert.ok(res.body.guardian.verifiedAt);
  assert.equal(JSON.stringify(res.body).includes(code), false);
  assert.equal(JSON.stringify(res.body).includes(hash), false);
  // A second verify finds no pending code.
  const again = await post(`/guardians/${id}/verify`, { code });
  assert.equal(again.status, 409);
});

test("POST /guardians/:id/verify: wrong code → 400; non-string code → 400", async () => {
  const { id, code } = await registeredWithCode();
  const wrong = code === "000000" ? "000001" : "000000";
  const res = await post(`/guardians/${id}/verify`, { code: wrong });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Invalid verification code/);
  assert.equal((await post(`/guardians/${id}/verify`, { code: 123456 })).status, 400);
});

test("POST /guardians/:id/availability: pending → 409; verified → toggles; non-boolean → 400", async () => {
  const { id, code } = await registeredWithCode();
  const pending = await post(`/guardians/${id}/availability`, { available: true });
  assert.equal(pending.status, 409);
  assert.match(pending.body.error, /must be verified/);
  assert.equal((await post(`/guardians/${id}/availability`, { available: "yes" })).status, 400);
  await post(`/guardians/${id}/verify`, { code });
  const on = await post(`/guardians/${id}/availability`, { available: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.guardian.available, true);
  const off = await post(`/guardians/${id}/availability`, { available: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.guardian.available, false);
});

test("GET /guardian/:id: owner read → 200 public shape; no key → 401", async () => {
  const { body } = await register();
  const id = body.guardian.id;
  const res = await get(`/guardian/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.guardian.id, id);
  assert.equal(res.body.guardian.state, "pending");
  const noKey = await get(`/guardian/${id}`, { "Content-Type": "application/json" });
  assert.equal(noKey.status, 401);
});
