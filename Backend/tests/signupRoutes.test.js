// 🔐 Signup phone-verification routes tests — SafeLife phone-OTP signup.
// Real Express app over HTTP (simulation-suite pattern). Every external
// dependency is unconfigured, so no message can leave this process —
// in particular SMS is unconfigured, so request-code must honestly
// 503 (verification-unavailable) instead of pretending a code was
// sent. The verify path is exercised over HTTP with a code issued
// through the in-process service seam (the same code the route would
// hand to the SMS adapter) — the code itself never travels in any
// response, and a test asserts exactly that.
//
// Namespace test: a guardian code must never verify a signup and a
// signup code must never verify a guardian — the two flows share the
// code math but not the store.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "signup-test-secret";
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
const signupCode = require("../services/signupCode");
const guardianStore = require("../services/guardianStore");
const { createGuardian, issueCode } = require("../services/guardian");

const KEY = "test-token";
const HEADERS = { "Content-Type": "application/json", Authorization: bearer() };
const PLAIN = { "Content-Type": "application/json" };
const PHONE = "+919876543210";
// Run-3 fix round 2: POST /auth/signup/verify-code now carries
// phoneCodeLimiter (5/min per phone), so verify-heavy tests each
// use their own phone — otherwise the shared PHONE's bucket is
// spent by earlier tests in this file and later verifies 429.
let freshPhoneN = 0;
const freshPhone = () => `+919000000${String(100 + freshPhoneN++)}`;

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
beforeEach(() => {
  signupCode._clearMemory();
  guardianStore._clearMemory();
});

const post = (path, body, headers = PLAIN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const requestCode = (phone = PHONE) => post("/auth/signup/request-code", { phone });
const verifyCode = (phone = PHONE, code) => post("/auth/signup/verify-code", { phone, code });

// Issues a code through the in-process service seam — the same code
// the route would hand to the SMS adapter when it is configured.
const issueSeam = async (phone = PHONE) => (await signupCode.issueSignupCode(phone)).code;

// Minimal in-memory PostgREST fake for the cross-instance test:
// POST upserts by id, GET ?phone=eq.<value> returns the matching row.
const fakeDb = () => {
  const rows = new Map();
  const transport = async (call) => {
    const u = new URL(call.url);
    if (call.method === "POST") {
      rows.set(call.body.id, { ...call.body });
      return { data: null };
    }
    const value = (u.searchParams.get("phone") || "").replace(/^eq\./, "");
    const row = [...rows.values()].find((r) => r.phone === value);
    return { data: row ? [row] : [] };
  };
  return { transport, rows };
};

test("POST /auth/signup/request-code: invalid phone → 400", async () => {
  assert.equal((await requestCode("junk")).status, 400);
  assert.equal((await requestCode("")).status, 400);
});

test("POST /auth/signup/request-code: SMS unconfigured → 503 channel-not-configured, no code issued", async () => {
  const res = await requestCode();
  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.sent, false);
  assert.equal(res.body.reason, "channel-not-configured");
  assert.equal(signupCode._hasPending(PHONE), false);
  // Nothing was issued: a verify now fails generic (R1i — one
  // status, one message for every verify failure).
  const verify = await verifyCode(PHONE, "123456");
  assert.equal(verify.status, 400);
  assert.equal(verify.body.error, "Invalid or expired code");
});

test("POST /auth/signup/request-code: SMS configured (stubbed fetch) → 200 sent, code pending", async () => {
  const realFetch = global.fetch;
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  // Fake ONLY the httpSMS call — the test's own HTTP calls to the
  // local server must still go through the real fetch.
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.httpsms.com")) return { ok: true };
    return realFetch(url, opts);
  };
  try {
    const res = await requestCode();
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.sent, true);
    assert.equal(signupCode._hasPending(PHONE), true);
    assert.equal(JSON.stringify(res.body).includes("hash"), false);
  } finally {
    global.fetch = realFetch;
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
  }
});

test("POST /auth/signup/request-code: 4th code in an hour → indistinguishable success (R1b)", async () => {
  // The ledger is filled through the service seam so the HTTP
  // request-code budget (codeLimiter 10/hr) is spent only once.
  // SMS must look configured or the route 503s before issuing.
  await issueSeam();
  await issueSeam();
  await issueSeam();
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  try {
    // A per-phone ledger refusal answers EXACTLY like a fresh send —
    // no 429, no error text, no sent:false.
    const res = await requestCode();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, sent: true });
  } finally {
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
  }
});

test("POST /auth/signup/verify-code: issued code → 200 verified + proof token; response carries no code or hash", async () => {
  const phone = freshPhone();
  const code = await issueSeam(phone);
  const res = await verifyCode(phone, code);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.verified, true);
  // R1c: the proof binds (phone, expiry) in expiry.HMAC form.
  assert.match(res.body.proof, /^\d+\.[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(res.body).includes(code), false);
  // A second verify finds no pending code — same generic 400 (R1i).
  const again = await verifyCode(phone, code);
  assert.equal(again.status, 400);
  assert.equal(again.body.error, "Invalid or expired code");
});

test("POST /auth/signup/verify-code: every failure is one generic 400 (R1i)", async () => {
  const phone = freshPhone();
  const code = await issueSeam(phone);
  const wrong = code === "000000" ? "000001" : "000000";
  // Wrong guesses, the 5th (killing) guess, and a late correct guess
  // after the kill all read exactly the same — no attempts-left count,
  // no killed/expired distinction.
  for (let i = 0; i < 5; i++) {
    const res = await verifyCode(phone, wrong);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Invalid or expired code");
  }
  // The 6th attempt inside the same minute hits the per-phone
  // phoneCodeLimiter (5/min) — 429, not another 400. The code is
  // already killed by then, so nothing is lost by refusing it.
  const late = await verifyCode(phone, code);
  assert.equal(late.status, 429);
});

test("POST /auth/signup/verify-code: no pending code → 400 generic; bad phone / code shape → 400", async () => {
  const phone = freshPhone();
  const noCode = await verifyCode(phone, "123456");
  assert.equal(noCode.status, 400);
  assert.equal(noCode.body.error, "Invalid or expired code");
  assert.equal((await verifyCode("junk", "123456")).status, 400);
  assert.equal((await verifyCode(phone, "12345")).status, 400);
  assert.equal((await verifyCode(phone, 123456)).status, 400);
});

test("Namespaces are separate: guardian code cannot verify a signup, signup code cannot verify a guardian", async () => {
  const guardianPhone = "+919876543211";
  const signupPhone = "+919876543212";
  // Guardian side: a real guardian record with its own issued code.
  const guardian = createGuardian({ userId: "test-user", name: "N", phone: guardianPhone, role: "family" });
  const { code: guardianCode } = issueCode(guardian);
  guardianStore.save(guardian);
  // The guardian code is worthless to the signup endpoint.
  const crossSignup = await verifyCode(guardianPhone, guardianCode);
  assert.equal(crossSignup.status, 400);
  assert.equal(crossSignup.body.error, "Invalid or expired code");
  // And the guardian endpoint still accepts its own code.
  const ownGuardian = await post(`/guardians/${guardian.id}/verify`, { code: guardianCode }, HEADERS);
  assert.equal(ownGuardian.status, 200);
  // Signup side: a signup code is worthless to the guardian endpoint.
  const signupCodeValue = await issueSeam(signupPhone);
  const other = createGuardian({ userId: "test-user", name: "M", phone: signupPhone, role: "friend" });
  guardianStore.save(other);
  const crossGuardian = await post(`/guardians/${other.id}/verify`, { code: signupCodeValue }, HEADERS);
  assert.equal(crossGuardian.status, 400);
  assert.equal(crossGuardian.body.error, "Invalid or expired code");
  // And the signup endpoint still accepts its own code.
  const ownSignup = await verifyCode(signupPhone, signupCodeValue);
  assert.equal(ownSignup.status, 200);
  assert.equal(ownSignup.body.verified, true);
});

test("POST /auth/signup/request-code: bare 10-digit phone is rejected (R1a)", async () => {
  // Run-2 R1a: no silent +91 default — a bare number has no explicit
  // country code, so it is a 400 and NO SMS is attempted.
  const realFetch = global.fetch;
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  let sentTo = null;
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.httpsms.com")) {
      sentTo = JSON.parse(opts.body).to;
      return { ok: true };
    }
    return realFetch(url, opts);
  };
  try {
    const res = await requestCode("6396039797");
    assert.equal(res.status, 400);
    assert.equal(sentTo, null);
    assert.equal(signupCode._hasPending("6396039797"), false);
  } finally {
    global.fetch = realFetch;
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
  }
});

test("POST /auth/signup/verify-code: code survives a memory clear (cross-instance DB mirror)", async () => {
  // Simulate a verify landing on another Vercel instance: the code
  // was issued here, memory is gone, only Postgres still has it.
  const { _setDbTransport } = require("../services/supabaseDb");
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const { transport } = fakeDb();
  _setDbTransport(transport);
  try {
    const phone = freshPhone();
    const code = await issueSeam(phone);
    assert.equal(signupCode._hasPending(phone), true);
    signupCode._clearMemory();
    assert.equal(signupCode._hasPending(phone), false);
    const res = await verifyCode(phone, code);
    assert.equal(res.status, 200);
    assert.equal(res.body.verified, true);
  } finally {
    _setDbTransport(null);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("POST /auth/signup/request-code: mirror save failure → 502, NO SMS sent (R1j)", async () => {
  // The DB looks configured but every mirror write throws: the code
  // is never persisted, so the route must 502 before any SMS leaves.
  const { _setDbTransport } = require("../services/supabaseDb");
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  _setDbTransport(async (call) => {
    if (call.method === "POST") throw new Error("db down");
    return { data: [] };
  });
  const realFetch = global.fetch;
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  let sentTo = null;
  global.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.httpsms.com")) {
      sentTo = JSON.parse(opts.body).to;
      return { ok: true };
    }
    return realFetch(url, opts);
  };
  try {
    const res = await requestCode("+919876543213");
    assert.equal(res.status, 502);
    assert.equal(sentTo, null);
    assert.equal(signupCode._hasPending("+919876543213"), false);
  } finally {
    global.fetch = realFetch;
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
    _setDbTransport(null);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
