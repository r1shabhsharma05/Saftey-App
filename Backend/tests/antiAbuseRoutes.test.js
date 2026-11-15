// Anti-abuse D23 route tests — SafeLife 2.0 Day 23: strikes, code
// limiter, fake-alert close reasons, admin audit read-back.
// Real Express app over HTTP (simulation-suite pattern). Every external
// dependency is unconfigured, so no message can leave this process.
// NOTE on ordering: the rate-limiter buckets are per-process memory,
// so the code-limiter exhaustion test runs FIRST (it is the only test
// that calls request-code over HTTP) and strikes are reset per test.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d23-route-secret";
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
const { setupJwtAuth, teardownJwtAuth, bearer } = require("./jwtAuth");
setupJwtAuth();
const alertStore = require("../services/alertStore");
const guardianStore = require("../services/guardianStore");
const { createAlert, transition } = require("../services/alertLifecycle");
const { issueCode } = require("../services/guardian");
const strikes = require("../services/strikes");
const { audit, _setWriteSink } = require("../services/audit");
const { _setDbTransport } = require("../services/supabaseDb");
const { _setAuthTransport } = require("../services/supabaseAuth");

const KEY = "test-token";
const HEADERS = { "Content-Type": "application/json", Authorization: bearer() };
const IP_ACTOR = "ip:127.0.0.1";

let server;
let base;
let auditLines;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  strikes._reset();
  guardianStore._clearMemory();
  auditLines = [];
  _setWriteSink((line) => auditLines.push(line));
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

const seedDelivered = () => {
  const alert = createAlert({ contactsCount: 0, ownerId: "test-user" });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  return alert;
};

const sos = () =>
  post("/alert", { lat: 28.6315, lng: 77.2167, name: "Test", phone: "+919876543210" });

// --- code limiter (runs first: the only HTTP request-code calls) ---

test("request-code: 11th call in an hour from one IP → 429 (codeLimiter)", async () => {
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const phone = `+9198765432${String(10 + i).padStart(2, "0")}`;
    const reg = await post("/guardians", { userId: `user-${i}`, name: "R", phone, role: "family" });
    assert.equal(reg.status, 200);
    const res = await post(`/guardians/${reg.body.guardian.id}/request-code`, {});
    statuses.push(res.status);
  }
  // SMS is unconfigured, so the first 10 honestly 503 — but the 11th
  // must be the limiter's 429, not another 503.
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(503));
  assert.equal(statuses[10], 429);
});

// --- strikes via fake-alert closes ---

test("3 false-alarm closes → SOS 403, no alert created, audit line written", async () => {
  for (let i = 0; i < 3; i++) {
    const alert = seedDelivered();
    const closed = await post(`/alert/${alert.id}/close`, { reason: "false-alarm" });
    assert.equal(closed.status, 200);
  }
  assert.equal(strikes.strikeCount(IP_ACTOR), 3);
  assert.equal(strikes.isBlocked(IP_ACTOR), true);
  const blocked = await sos();
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /strike/i);
  assert.equal(blocked.body.alertId, undefined);
  assert.ok(auditLines.some((l) => l.includes("alert.blocked_by_strikes")));
});

test("resolved and duplicate closes do not strike; SOS still works", async () => {
  const a = seedDelivered();
  assert.equal((await post(`/alert/${a.id}/close`, { reason: "resolved" })).status, 200);
  const b = seedDelivered();
  assert.equal((await post(`/alert/${b.id}/close`, { reason: "duplicate" })).status, 200);
  assert.equal(strikes.strikeCount(IP_ACTOR), 0);
  // Channels are unconfigured here, so a passed SOS honestly 502s on
  // delivery — the point is the strike gate passed (not 403) and an
  // alert was created.
  const res = await sos();
  assert.notEqual(res.status, 403);
  assert.ok(res.body.alertId);
});

test("close with an invalid reason → 400, no strike", async () => {
  const alert = seedDelivered();
  const res = await post(`/alert/${alert.id}/close`, { reason: "bogus" });
  assert.equal(res.status, 400);
  assert.equal(strikes.strikeCount(IP_ACTOR), 0);
});

// --- strikes via verification-code brute force ---

test("3 code brute-forces → strike each; SOS 403 after the 3rd, 200 after the 1st", async () => {
  for (let g = 0; g < 3; g++) {
    const phone = `+9198000000${g}`;
    const reg = await post("/guardians", { userId: `user-bf-${g}`, name: "B", phone, role: "family" });
    assert.equal(reg.status, 200);
    const guardian = await guardianStore.get(reg.body.guardian.id);
    issueCode(guardian);
    guardianStore.save(guardian);
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await post(`/guardians/${guardian.id}/verify`, { code: "000000" });
      // Run-2 R1i: the killed 5th attempt is the same generic 400 as
      // every other verify failure — the strike is still recorded.
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "Invalid or expired code");
    }
    assert.equal(strikes.strikeCount(IP_ACTOR), g + 1);
    if (g === 0) {
      const res = await sos();
      assert.notEqual(res.status, 403);
      assert.ok(res.body.alertId);
    }
  }
  assert.equal(strikes.isBlocked(IP_ACTOR), true);
  assert.equal((await sos()).status, 403);
});

// --- admin audit read-back ---

test("GET /admin/audit: no JWT and no key → 401", async () => {
  const res = await get("/admin/audit", { "Content-Type": "application/json" });
  assert.equal(res.status, 401);
});

test("GET /admin/audit: bad JWT → 401 (JWT only, run-2 3.3; no shared-key fallback)", async () => {
  const res = await get("/admin/audit", { ...HEADERS, Authorization: bearer("wrong") });
  assert.equal(res.status, 401);
});

test("GET /admin/audit: JWT user not on the allowlist → 403", async () => {
  _setAuthTransport(async () => ({ status: 200, data: { id: "not-an-admin", email: "n@x.y" } }));
  process.env.ADMIN_USER_IDS = "admin-1";
  // JWT verification needs a URL + key (anon is enough); the DB
  // stays unconfigured here — the allowlist rejects before any read.
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    const res = await get("/admin/audit", { ...HEADERS, Authorization: "Bearer good-jwt" });
    assert.equal(res.status, 403);
  } finally {
    _setAuthTransport(null);
    delete process.env.ADMIN_USER_IDS;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("GET /admin/audit: Supabase unconfigured → honest 503", async () => {
  _setAuthTransport(async () => ({ status: 200, data: { id: "admin-1", email: "a@b.c" } }));
  process.env.ADMIN_USER_IDS = "admin-1";
  // JWT verification needs a URL + key (anon is enough), but the DB
  // read needs the service key — absent here, so the route 503s.
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  try {
    const res = await get("/admin/audit", { ...HEADERS, Authorization: "Bearer good-jwt" });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  } finally {
    _setAuthTransport(null);
    delete process.env.ADMIN_USER_IDS;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test("GET /admin/audit: configured → 200 newest-first, limit clamped", async () => {
  const rows = [
    { ts: "2026-11-14T10:00:00.000Z", action: "alert.created", actor: "fp1", ip: "1.1.1.1", alert_id: "a1", meta: null },
    { ts: "2026-11-14T09:00:00.000Z", action: "alert.closed", actor: "fp1", ip: "1.1.1.1", alert_id: "a1", meta: null },
  ];
  const seenUrls = [];
  _setAuthTransport(async () => ({ status: 200, data: { id: "admin-1", email: "a@b.c" } }));
  process.env.ADMIN_USER_IDS = "admin-1";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "d23-test-key";
  _setDbTransport(async (call) => {
    seenUrls.push(call.url);
    return { data: rows };
  });
  try {
    const authHeaders = { ...HEADERS, Authorization: "Bearer good-jwt" };
    const res = await get("/admin/audit?limit=500", authHeaders);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, "postgres");
    assert.equal(res.body.events.length, 2);
    assert.equal(res.body.events[0].action, "alert.created");
    // The audit_read audit() call also hits the mocked transport, so
    // filter to the list reads (order=ts.desc) before checking limits.
    const listUrls = seenUrls.filter((u) => u.includes("order=ts.desc"));
    assert.ok(listUrls[0].includes("limit=100"));
    const res2 = await get("/admin/audit?limit=abc", authHeaders);
    assert.equal(res2.status, 200);
    const listUrls2 = seenUrls.filter((u) => u.includes("order=ts.desc"));
    assert.ok(listUrls2[1].includes("limit=50"));
  } finally {
    _setAuthTransport(null);
    delete process.env.ADMIN_USER_IDS;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    _setDbTransport(null);
  }
});
