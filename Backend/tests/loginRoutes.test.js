// 🔐 Login / forgot-password / signup-complete / delete-account route tests (run-2).
// Real Express app over HTTP. Supabase is faked twice: the PostgREST
// transport (_setDbTransport) for profile lookups + code mirrors, and
// the Auth REST transport (_setAuthTransport) for JWT verification +
// admin create/delete. No network, no real project.
//
// Run-2 contracts under test:
// - R1h: /auth/login/resolve is GONE (404); login is request-code +
//   verify-code, and {email} comes back ONLY after a verified code.
// - R1i: every verify failure is one generic 400.
// - R1c: signup/complete needs the proof; the proof is single-use.
// - 2.3: forgot-password answers the same generic success hit/miss.
// - 12.3: DELETE /auth/account is JWT-only and wipes the user's rows.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { _setDbTransport } = require("../services/supabaseDb");
const { _setAuthTransport } = require("../services/supabaseAuth");
const loginCode = require("../services/loginCode");
const signupCode = require("../services/signupCode");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

process.env.API_SECRET = "login-test-secret";
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
]) {
  delete process.env[v];
}

const app = require("../server");

const PLAIN = { "Content-Type": "application/json" };
const ROW = { id: "user-1", phone: "+919876543210", email: "ramesh@example.com" };

let server;
let base;
let dbCalls;
let profileRows;
let authCalls;

const setDbEnv = (url, key) => {
  if (url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
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
  setDbEnv("https://example.supabase.co", "service-role-key");
  dbCalls = [];
  profileRows = [];
  authCalls = [];
  loginCode._clearMemory();
  signupCode._clearMemory();
  _setDbTransport(async (call) => {
    dbCalls.push(call);
    if (call.method === "PATCH") return { data: [{ id: "consumed" }] };
    if (call.method === "GET" && call.url.includes("/profiles?")) return { data: profileRows };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com" } };
    }
    return { status: 200, data: {} };
  });
});
after(() => {
  _setDbTransport(null);
  _setAuthTransport(null);
  setDbEnv(OLD_URL, OLD_KEY);
});

const post = (path, body, headers = PLAIN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const del = (path, headers = PLAIN) =>
  fetch(`${base}${path}`, { method: "DELETE", headers }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));

// SMS stub: only the httpSMS call is faked; the test's own HTTP calls
// still go through the real fetch.
const withSms = async (fn) => {
  const realFetch = global.fetch;
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.httpsms.com")) return { ok: true };
    return realFetch(url, opts);
  };
  try {
    await fn();
  } finally {
    global.fetch = realFetch;
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
  }
};

test("POST /auth/login/resolve is gone (R1h)", async () => {
  const res = await post("/auth/login/resolve", { phone: "+919876543210" });
  assert.equal(res.status, 404);
});

test("POST /auth/login/request-code: invalid phone → 400; SMS unconfigured → 503", async () => {
  assert.equal((await post("/auth/login/request-code", { phone: "junk" })).status, 400);
  assert.equal((await post("/auth/login/request-code", { phone: "+919876543210" })).status, 503);
});

test("POST /auth/login/request-code: SMS configured → 200 sent", async () => {
  await withSms(async () => {
    const res = await post("/auth/login/request-code", { phone: "+919876543211" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, sent: true });
    assert.equal(loginCode._hasPending("+919876543211"), true);
  });
});

test("POST /auth/login/request-code: per-phone cap → indistinguishable success (R1b)", async () => {
  const phone = "+919876543212";
  await loginCode.issueLoginCode(phone);
  await loginCode.issueLoginCode(phone);
  await loginCode.issueLoginCode(phone);
  await withSms(async () => {
    const res = await post("/auth/login/request-code", { phone });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, sent: true });
  });
});

test("POST /auth/login/verify-code: wrong code → 400 generic (R1i)", async () => {
  const phone = "+919876543213";
  const { code } = await loginCode.issueLoginCode(phone);
  const wrong = code === "000000" ? "000001" : "000000";
  const res = await post("/auth/login/verify-code", { phone, code: wrong });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid or expired code");
});

test("POST /auth/login/verify-code: verified code + account → 200 with ONLY the email", async () => {
  const phone = "+919876543214";
  profileRows = [{ ...ROW, phone }];
  const { code } = await loginCode.issueLoginCode(phone);
  const res = await post("/auth/login/verify-code", { phone, code });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["email", "success"]);
  assert.equal(res.body.email, "ramesh@example.com");
  assert.equal(JSON.stringify(res.body).includes(phone), false);
});

test("POST /auth/login/verify-code: verified code + NO account → same generic 400 (R1i)", async () => {
  const phone = "+919876543215";
  profileRows = [];
  const { code } = await loginCode.issueLoginCode(phone);
  const res = await post("/auth/login/verify-code", { phone, code });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid or expired code");
});

test("POST /auth/login/verify-code: DB unconfigured after verify → 503", async () => {
  const phone = "+919876543216";
  const { code } = await loginCode.issueLoginCode(phone);
  setDbEnv(undefined, undefined);
  try {
    const res = await post("/auth/login/verify-code", { phone, code });
    assert.equal(res.status, 503);
  } finally {
    setDbEnv("https://example.supabase.co", "service-role-key");
  }
});

test("POST /auth/forgot-password: hit and miss answer identically (2.3)", async () => {
  // Hit first: the fake transport returns the row for the profile lookup.
  profileRows = [{ ...ROW, phone: "+919876543217" }];
  const hit = await post("/auth/forgot-password", { phone: "+919876543217" });
  // Miss: no profile row at all.
  profileRows = [];
  const miss = await post("/auth/forgot-password", { phone: "+919876543218" });
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.body, miss.body);
  assert.equal(hit.body.success, true);
  // The hit triggered exactly one server-side reset email.
  assert.equal(authCalls.filter((c) => c.url.includes("/auth/v1/recover")).length, 1);
  assert.equal((await post("/auth/forgot-password", { phone: "junk" })).status, 400);
});

test("POST /auth/signup/complete: proof required, single-use, creates the account (R1c)", async () => {
  const phone = "+919876543219";
  const { code } = await signupCode.issueSignupCode(phone);
  const { proof } = await signupCode.verifySignupCode(phone, code);
  assert.match(proof, /^\d+\.[0-9a-f]{64}$/);
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/admin/users") && call.method === "POST") {
      assert.equal(call.body.email_confirm, true);
      assert.equal(call.body.user_metadata.phone, phone);
      return { status: 201, data: { id: "new-user", email: "new@example.com" } };
    }
    return { status: 200, data: {} };
  });
  const res = await post("/auth/signup/complete", {
    proof,
    email: "new@example.com",
    password: "secret123",
    name: "New User",
    phone,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  // The proof is single-use: replaying it fails.
  const replay = await post("/auth/signup/complete", {
    proof,
    email: "new@example.com",
    password: "secret123",
    name: "New User",
    phone,
  });
  assert.equal(replay.status, 400);
});

test("POST /auth/signup/complete: bad proof → 400; already-registered reads generic (2.3)", async () => {
  const phone = "+919876543220";
  const res = await post("/auth/signup/complete", {
    proof: "123.abc",
    email: "x@example.com",
    password: "secret123",
    name: "X",
    phone,
  });
  assert.equal(res.status, 400);
  // A verified proof whose email already exists must read exactly
  // like any other create failure — never "already registered".
  const { code } = await signupCode.issueSignupCode(phone);
  const { proof } = await signupCode.verifySignupCode(phone, code);
  _setAuthTransport(async () => ({ status: 422, data: { msg: "User already registered" } }));
  const dup = await post("/auth/signup/complete", {
    proof,
    email: "taken@example.com",
    password: "secret123",
    name: "Taken",
    phone,
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error, "Could not create account — please try again");
  assert.equal(JSON.stringify(dup.body).includes("already"), false);
});

test("DELETE /auth/account: no JWT → 401; shared key alone → 401 (JWT only, 12.3)", async () => {
  assert.equal((await del("/auth/account")).status, 401);
  assert.equal(
    (await del("/auth/account", { ...PLAIN, "x-api-key": "login-test-secret" })).status,
    401
  );
});

test("DELETE /auth/account: JWT → deletes auth user + wipes rows + avatar", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com" } };
    }
    if (call.url.includes("/auth/v1/admin/users/user-1")) {
      return { status: 204, data: null };
    }
    if (call.url.includes("/storage/v1/object/avatars/user-1/avatar.jpg")) {
      return { status: 404, data: null };
    }
    return { status: 200, data: {} };
  });
  const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer good-jwt" });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  const urls = dbCalls.map((c) => `${c.method} ${c.url}`);
  for (const table of ["profiles", "emergency_contacts", "guardians", "journeys", "sos_alerts", "signup_codes"]) {
    assert.ok(urls.some((u) => u.startsWith("DELETE") && u.includes(`/rest/v1/${table}?`)), table);
  }
  assert.ok(authCalls.some((c) => c.url.includes("/storage/v1/object/avatars/user-1/avatar.jpg")));
});
