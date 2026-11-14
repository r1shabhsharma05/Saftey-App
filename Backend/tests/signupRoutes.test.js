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
const signupCode = require("../services/signupCode");
const guardianStore = require("../services/guardianStore");
const { createGuardian, issueCode } = require("../services/guardian");

const KEY = "signup-test-secret";
const HEADERS = { "Content-Type": "application/json", "x-api-key": KEY };
const PLAIN = { "Content-Type": "application/json" };
const PHONE = "+919876543210";

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
const issueSeam = (phone = PHONE) => signupCode.issueSignupCode(phone).code;

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
  // Nothing was issued: a verify now must say no code is pending.
  const verify = await verifyCode(PHONE, "123456");
  assert.equal(verify.status, 409);
  assert.match(verify.body.error, /No verification code pending/);
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

test("POST /auth/signup/request-code: 4th code in an hour → 429 (per-phone ledger)", async () => {
  // The ledger is filled through the service seam so the HTTP
  // request-code budget (codeLimiter 10/hr) is spent only once.
  // SMS must look configured or the route 503s before issuing.
  issueSeam();
  issueSeam();
  issueSeam();
  process.env.HTTPSMS_API_KEY = "test-key";
  process.env.HTTPSMS_FROM = "+919999999999";
  try {
    const res = await requestCode();
    assert.equal(res.status, 429);
    assert.match(res.body.error, /Too many verification codes/);
  } finally {
    delete process.env.HTTPSMS_API_KEY;
    delete process.env.HTTPSMS_FROM;
  }
});

test("POST /auth/signup/verify-code: issued code → 200 verified; response carries no code or hash", async () => {
  const code = issueSeam();
  const res = await verifyCode(PHONE, code);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.verified, true);
  assert.equal(JSON.stringify(res.body).includes(code), false);
  // A second verify finds no pending code.
  const again = await verifyCode(PHONE, code);
  assert.equal(again.status, 409);
});

test("POST /auth/signup/verify-code: wrong code → 400 with attempts left; 5th wrong → 409 killed", async () => {
  const code = issueSeam();
  const wrong = code === "000000" ? "000001" : "000000";
  const first = await verifyCode(PHONE, wrong);
  assert.equal(first.status, 400);
  assert.match(first.body.error, /Invalid verification code \(4 attempts left\)/);
  for (let i = 0; i < 3; i++) {
    assert.equal((await verifyCode(PHONE, wrong)).status, 400);
  }
  const killed = await verifyCode(PHONE, wrong);
  assert.equal(killed.status, 409);
  assert.match(killed.body.error, /Too many attempts/);
  // The killed code stays dead even for the right digits.
  const late = await verifyCode(PHONE, code);
  assert.equal(late.status, 409);
  assert.match(late.body.error, /No verification code pending/);
});

test("POST /auth/signup/verify-code: no pending code → 409; bad phone / code shape → 400", async () => {
  const noCode = await verifyCode(PHONE, "123456");
  assert.equal(noCode.status, 409);
  assert.match(noCode.body.error, /No verification code pending/);
  assert.equal((await verifyCode("junk", "123456")).status, 400);
  assert.equal((await verifyCode(PHONE, "12345")).status, 400);
  assert.equal((await verifyCode(PHONE, 123456)).status, 400);
});

test("Namespaces are separate: guardian code cannot verify a signup, signup code cannot verify a guardian", async () => {
  const guardianPhone = "+919876543211";
  const signupPhone = "+919876543212";
  // Guardian side: a real guardian record with its own issued code.
  const guardian = createGuardian({ userId: "user-9", name: "N", phone: guardianPhone, role: "family" });
  const { code: guardianCode } = issueCode(guardian);
  guardianStore.save(guardian);
  // The guardian code is worthless to the signup endpoint.
  const crossSignup = await verifyCode(guardianPhone, guardianCode);
  assert.equal(crossSignup.status, 409);
  assert.match(crossSignup.body.error, /No verification code pending/);
  // And the guardian endpoint still accepts its own code.
  const ownGuardian = await post(`/guardians/${guardian.id}/verify`, { code: guardianCode }, HEADERS);
  assert.equal(ownGuardian.status, 200);
  // Signup side: a signup code is worthless to the guardian endpoint.
  const signupCodeValue = issueSeam(signupPhone);
  const other = createGuardian({ userId: "user-10", name: "M", phone: signupPhone, role: "friend" });
  guardianStore.save(other);
  const crossGuardian = await post(`/guardians/${other.id}/verify`, { code: signupCodeValue }, HEADERS);
  assert.equal(crossGuardian.status, 409);
  assert.match(crossGuardian.body.error, /No verification code pending/);
  // And the signup endpoint still accepts its own code.
  const ownSignup = await verifyCode(signupPhone, signupCodeValue);
  assert.equal(ownSignup.status, 200);
  assert.equal(ownSignup.body.verified, true);
});
