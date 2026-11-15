// 🔒 SafeLife fix round 3 route tests (run-4 findings).
// Real Express app over HTTP. Supabase is faked twice: the PostgREST
// transport (_setDbTransport) for profile lookups + audit reads, and
// the Auth REST transport (_setAuthTransport) for JWT verification +
// password recovery. No network, no real project.
//
// - 6.3: POST /auth/forgot-password enforces Turnstile (hard 400 when
//   configured + token missing/invalid; generic success preserved;
//   fail-open while TURNSTILE_SECRET_KEY is unset).
// - 6.1: POST /guardians/:id/request-code carries phoneCodeLimiter
//   (guardian:<id>, 5/min) on top of codeLimiter — 6th request → 429.
// - F-3.1R: POST /alert/:id/message 403s on null-owner alerts in both
//   branches (victim + guardian sender), via owns().
// - F-10.5a: GET /admin/audit logs the reader's user id as the audit
//   actor on denied + success paths, and audit-logs the 502 path.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.API_SECRET = "fix3-route-secret";
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
  "TURNSTILE_SECRET_KEY",
]) {
  delete process.env[v];
}

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLD_ANON = process.env.SUPABASE_ANON_KEY;

const app = require("../server");
const { _setDbTransport } = require("../services/supabaseDb");
const { _setAuthTransport } = require("../services/supabaseAuth");
const { _setWriteSink } = require("../services/audit");
const alertStore = require("../services/alertStore");
const guardianStore = require("../services/guardianStore");
const { createAlert, transition } = require("../services/alertLifecycle");
const { newGuardianAlertState } = require("../services/guardianAlert");

const HEADERS = { "Content-Type": "application/json", Authorization: "Bearer test-token" };
const ADMIN_HEADERS = { "Content-Type": "application/json", Authorization: "Bearer admin-token" };
const GENERIC = { success: true, message: "If an account exists for this number, a password reset link has been sent." };

let server;
let base;
let dbCalls;
let authCalls;
let profileRows;
let auditRows;
let auditLines;

// Fake Auth transport: token→user map (test-user + admin-1), records
// every call so tests can count password-recovery sends.
const installAuthTransport = () => {
  const map = {
    "test-token": { id: "test-user", email: "test@example.com" },
    "admin-token": { id: "admin-1", email: "admin@example.com" },
  };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/user")) {
      const token = (call.headers?.Authorization || "").replace(/^Bearer\s+/, "");
      const user = map[token];
      if (!user) return { status: 401, data: {} };
      return { status: 200, data: { id: user.id, email: user.email, last_sign_in_at: new Date().toISOString() } };
    }
    return { status: 200, data: {} };
  });
};

// Fake DB transport: profile lookups + audit-event list reads; audit
// mirror upserts answer { data: null }.
const installDbTransport = () => {
  _setDbTransport(async (call) => {
    dbCalls.push(call);
    if (call.method === "GET" && call.url.includes("/rest/v1/audit_events?")) return { data: auditRows };
    if (call.method === "GET" && call.url.includes("/profiles?")) return { data: profileRows };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
};

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ADMIN_USER_IDS;
  dbCalls = [];
  authCalls = [];
  profileRows = [];
  auditRows = [];
  auditLines = [];
  alertStore._clearMemory();
  guardianStore._clearMemory();
  installAuthTransport();
  installDbTransport();
  _setWriteSink((line) => auditLines.push(line));
});
after(() => {
  _setDbTransport(null);
  _setAuthTransport(null);
  _setWriteSink((l) => process.stdout.write(l + "\n"));
  if (OLD_URL !== undefined) process.env.SUPABASE_URL = OLD_URL;
  else delete process.env.SUPABASE_URL;
  if (OLD_KEY !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
  else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (OLD_ANON !== undefined) process.env.SUPABASE_ANON_KEY = OLD_ANON;
  else delete process.env.SUPABASE_ANON_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  delete process.env.ADMIN_USER_IDS;
});

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

const auditEntry = (action) => auditLines.map((l) => JSON.parse(l)).find((e) => e.action === action);
const recoverCalls = () => authCalls.filter((c) => c.url.includes("/auth/v1/recover")).length;

// --- 6.3: forgot-password Turnstile ---

test("POST /auth/forgot-password: Turnstile configured + missing token → 400, no lookup, no reset (6.3)", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fix3-test-key"; // DB configured, so a lookup WOULD have happened
  profileRows = [{ id: "user-1", phone: "+919876543231", email: "ramesh@example.com" }];
  const res = await post("/auth/forgot-password", { phone: "+919876543231" }, { "Content-Type": "application/json" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Human verification failed — please try again");
  assert.equal(recoverCalls(), 0);
  assert.equal(dbCalls.some((c) => c.url.includes("/profiles?")), false);
});

test("POST /auth/forgot-password: Turnstile configured + valid token → generic 200, reset sent (6.3)", async () => {
  process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fix3-test-key";
  profileRows = [{ id: "user-1", phone: "+919876543232", email: "ramesh@example.com" }];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("challenges.cloudflare.com")) {
      return { json: async () => ({ success: true }) };
    }
    return realFetch(url, opts);
  };
  try {
    const res = await post("/auth/forgot-password", { phone: "+919876543232", turnstileToken: "valid-token" }, { "Content-Type": "application/json" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, GENERIC);
    assert.equal(recoverCalls(), 1);
  } finally {
    global.fetch = realFetch;
  }
});

test("POST /auth/forgot-password: Turnstile unset → fail-open generic 200, reset sent (6.3)", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fix3-test-key";
  profileRows = [{ id: "user-1", phone: "+919876543233", email: "ramesh@example.com" }];
  const res = await post("/auth/forgot-password", { phone: "+919876543233" }, { "Content-Type": "application/json" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, GENERIC);
  assert.equal(recoverCalls(), 1);
});

// --- 6.1: guardian request-code per-guardian limiter ---

test("POST /guardians/:id/request-code: 6th request in a minute → 429 (phoneCodeLimiter, 6.1)", async () => {
  const reg = await post("/guardians", { userId: "test-user", name: "Ramesh Kumar", phone: "+919876543240", role: "family" });
  assert.equal(reg.status, 200);
  const id = reg.body.guardian.id;
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    statuses.push((await post(`/guardians/${id}/request-code`, {})).status);
  }
  // SMS is unconfigured, so the first 5 honestly 503 — the 6th must
  // be the per-guardian limiter's 429, not another 503.
  assert.deepEqual(statuses.slice(0, 5), Array(5).fill(503));
  assert.equal(statuses[5], 429);
});

// --- F-3.1R: message route null-owner 403s ---

const seedDelivered = (ownerId) => {
  const alert = createAlert({ contactsCount: 0, lat: 28.6315, lng: 77.2167, ownerId });
  alert.guardians = newGuardianAlertState();
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  return alert;
};

test("POST /alert/:id/message: victim sender on a null-owner alert → 403; owned alert → 200 (F-3.1R)", async () => {
  const ownerless = seedDelivered(null);
  const denied = await post(`/alert/${ownerless.id}/message`, { sender: "victim", key: "please-hurry" });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Forbidden");
  const owned = seedDelivered("test-user");
  const ok = await post(`/alert/${owned.id}/message`, { sender: "victim", key: "please-hurry" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.success, true);
});

test("POST /alert/:id/message: guardian sender on a null-userId guardian record → 403 (F-3.1R)", async () => {
  const alert = seedDelivered("test-user");
  const ghost = {
    id: crypto.randomUUID(),
    userId: null,
    name: "Ghost",
    phone: "+919876543299",
    role: "family",
    state: "pending",
    available: false,
    verifiedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verification: null,
    codeRequests: [],
  };
  guardianStore.save(ghost);
  const res = await post(`/alert/${alert.id}/message`, { sender: "guardian", guardianId: ghost.id, key: "on-my-way" });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "Forbidden");
});

// --- F-10.5a: admin audit actor + failed-read logging ---

const configureAdminDb = () => {
  process.env.ADMIN_USER_IDS = "admin-1";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fix3-test-key";
};

test("GET /admin/audit: denied read logs admin.audit_denied with the caller's user id as actor (F-10.5a)", async () => {
  configureAdminDb();
  const res = await get("/admin/audit", HEADERS);
  assert.equal(res.status, 403);
  const entry = auditEntry("admin.audit_denied");
  assert.ok(entry, "denied read must be audit-logged");
  assert.equal(entry.actor, "test-user");
});

test("GET /admin/audit: successful read logs admin.audit_read with the admin's user id as actor (F-10.5a)", async () => {
  configureAdminDb();
  auditRows = [{ ts: "2026-11-14T10:00:00.000Z", action: "alert.created", actor: "fp1", ip: "1.1.1.1", alert_id: "a1", meta: null }];
  const res = await get("/admin/audit", ADMIN_HEADERS);
  assert.equal(res.status, 200);
  assert.equal(res.body.events.length, 1);
  const entry = auditEntry("admin.audit_read");
  assert.ok(entry, "successful read must be audit-logged");
  assert.equal(entry.actor, "admin-1");
});

test("GET /admin/audit: failed read → 502 AND an admin.audit_read_failed line with the admin as actor (F-10.5a)", async () => {
  configureAdminDb();
  _setDbTransport(async (call) => {
    dbCalls.push(call);
    if (call.method === "GET" && call.url.includes("/rest/v1/audit_events?")) return { data: "not-an-array" };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
  const res = await get("/admin/audit", ADMIN_HEADERS);
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "Audit read failed — please try again");
  const entry = auditEntry("admin.audit_read_failed");
  assert.ok(entry, "failed read must be audit-logged, not just console.log'd");
  assert.equal(entry.actor, "admin-1");
  assert.equal(entry.meta.reason, "unexpected-response");
});
