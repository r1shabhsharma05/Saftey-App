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
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com", last_sign_in_at: new Date().toISOString() } };
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
      assert.equal(call.body.user_metadata.date_of_birth, "2000-01-15");
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
    dateOfBirth: "2000-01-15",
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
    dateOfBirth: "2000-01-15",
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
    dateOfBirth: "2000-01-15",
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
    dateOfBirth: "2000-01-15",
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
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com", last_sign_in_at: new Date().toISOString() } };
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
  for (const table of ["profiles", "emergency_contacts", "guardians", "journeys", "sos_alerts", "signup_codes", "login_codes", "gnani_daily_usage"]) {
    assert.ok(urls.some((u) => u.startsWith("DELETE") && u.includes(`/rest/v1/${table}?`)), table);
  }
  assert.ok(authCalls.some((c) => c.url.includes("/storage/v1/object/avatars/user-1/avatar.jpg")));
});

// H5 follow-up (27 Nov): Supabase Storage answers 400 — not 404 —
// when the avatar object does not exist, so a user who never
// uploaded an avatar must still delete their account.
test("DELETE /auth/account: avatar DELETE 400 (no avatar) → still 200", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com", last_sign_in_at: new Date().toISOString() } };
    }
    if (call.url.includes("/auth/v1/admin/users/user-1")) {
      return { status: 204, data: null };
    }
    if (call.url.includes("/storage/v1/object/avatars/user-1/avatar.jpg")) {
      return { status: 400, data: null };
    }
    return { status: 200, data: {} };
  });
  const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer good-jwt" });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

// Run-3 fix round 2 (12.3): session freshness — a stale session
// (signed in > 15 min ago) must 401 REAUTH_REQUIRED, and a session
// with no freshness signal at all fails closed the same way.
test("DELETE /auth/account: stale session → 401 REAUTH_REQUIRED; no freshness signal → 401", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  _setAuthTransport(async (call) => {
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com", last_sign_in_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() } };
    }
    return { status: 200, data: {} };
  });
  const stale = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error, "REAUTH_REQUIRED");
  _setAuthTransport(async (call) => {
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com" } };
    }
    return { status: 200, data: {} };
  });
  const unknown = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, "REAUTH_REQUIRED");
});

// Run-3 fix round 2 (12.3): a failed table wipe is an honest 502
// delete-partial naming the failed tables — never { success: true }.
test("DELETE /auth/account: one wipe failing → 502 delete-partial with failed tables", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  _setDbTransport(async (call) => {
    dbCalls.push(call);
    if (call.method === "DELETE" && call.url.includes("/rest/v1/guardians?")) {
      throw new Error("guardians table down");
    }
    if (call.method === "PATCH") return { data: [{ id: "consumed" }] };
    if (call.method === "GET" && call.url.includes("/profiles?")) return { data: profileRows };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
  const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
  assert.equal(res.status, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, "delete-partial");
  assert.deepEqual(res.body.failed, ["guardians"]);
});

// Run-3 fix round 2 (12.3): in-memory alert/journey/guardian rows
// for the user are wiped by delete-account (deleteByOwner).
test("DELETE /auth/account: in-memory rows for the user are gone afterwards", async () => {
  const alertStore = require("../services/alertStore");
  const journeyStore = require("../services/journeyStore");
  const guardianStore = require("../services/guardianStore");
  const { createAlert } = require("../services/alertLifecycle");
  const { createJourney } = require("../services/journey");
  const { createGuardian } = require("../services/guardian");
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  alertStore._clearMemory();
  journeyStore._clearMemory();
  guardianStore._clearMemory();
  const alert = createAlert({ contactsCount: 0, lat: 1, lng: 1, ownerId: "user-1" });
  alertStore.save(alert);
  const journey = createJourney({ originLat: 1, originLng: 1, destLat: 2, destLng: 2, destinationLabel: "Home", expectedArrivalAt: new Date(Date.now() + 3600000).toISOString(), userName: "R", ownerId: "user-1", contacts: [] });
  journeyStore.save(journey);
  const guardian = createGuardian({ userId: "user-1", name: "G", phone: "+919876543211", role: "family" });
  guardianStore.save(guardian);
  assert.equal(alertStore._has(alert.id), true);
  assert.equal(journeyStore._has(journey.id), true);
  assert.equal(guardianStore._has(guardian.id), true);
  const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
  assert.equal(res.status, 200);
  assert.equal(alertStore._has(alert.id), false);
  assert.equal(journeyStore._has(journey.id), false);
  assert.equal(guardianStore._has(guardian.id), false);
  alertStore._clearMemory();
  journeyStore._clearMemory();
  guardianStore._clearMemory();
});

// ── H15 age gate + F-12.3R delete-account reorder (run-6 prep) ──

// DOB exactly N years ago today (Feb-29 clamped to Feb-28 so the
// test never breaks on leap-day runs).
const dobYearsAgo = (years) => {
  const n = new Date();
  let d = n.getUTCDate();
  const m = n.getUTCMonth() + 1;
  if (m === 2 && d === 29) d = 28;
  return `${n.getUTCFullYear() - years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const freshProof = async (phone) => {
  const { code } = await signupCode.issueSignupCode(phone);
  const { proof } = await signupCode.verifySignupCode(phone, code);
  return proof;
};

const completeWithDob = (phone, proof, dateOfBirth) =>
  post("/auth/signup/complete", {
    proof,
    email: "dob@example.com",
    password: "secret123",
    name: "Dob User",
    phone,
    ...(dateOfBirth === undefined ? {} : { dateOfBirth }),
  });

test("H15: signup/complete without dateOfBirth → 400; invalid dates → 400", async () => {
  const phone = "+919876543221";
  const proof = await freshProof(phone);
  // Missing DOB.
  assert.equal((await completeWithDob(phone, proof)).status, 400);
  // Not a real calendar date / wrong shape / future date.
  for (const bad of ["2000-02-30", "15/01/2000", "not-a-date", "2999-01-01", "2000-13-01"]) {
    const res = await completeWithDob(phone, proof, bad);
    assert.equal(res.status, 400, bad);
  }
});

test("H15: under-13 → 400 and the proof is NOT consumed; exactly 13 → 200, DOB stored", async () => {
  const phone = "+919876543222";
  const proof = await freshProof(phone);
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/admin/users") && call.method === "POST") {
      assert.equal(call.body.user_metadata.date_of_birth, dobYearsAgo(13));
      return { status: 201, data: { id: "new-user", email: "dob@example.com" } };
    }
    return { status: 200, data: {} };
  });
  const young = await completeWithDob(phone, proof, dobYearsAgo(12));
  assert.equal(young.status, 400);
  assert.match(young.body.error, /13/);
  // Same proof still works with a valid DOB — the 400 above did not burn it.
  const ok = await completeWithDob(phone, proof, dobYearsAgo(13));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.success, true);
});

test("DELETE /auth/account (F-12.3R): all wipes run BEFORE the auth user is deleted", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  const seq = [];
  _setDbTransport(async (call) => {
    seq.push(`db:${call.method} ${call.url}`);
    if (call.method === "PATCH") return { data: [{ id: "consumed" }] };
    if (call.method === "GET" && call.url.includes("/profiles?")) return { data: profileRows };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
  _setAuthTransport(async (call) => {
    seq.push(`auth:${call.method} ${call.url}`);
    if (call.url.includes("/auth/v1/user")) {
      return { status: 200, data: { id: "user-1", email: "ramesh@example.com", last_sign_in_at: new Date().toISOString() } };
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
  const adminIdx = seq.findIndex((s) => s.includes("/auth/v1/admin/users/user-1"));
  assert.ok(adminIdx > 0, "admin delete must be called");
  const wipeIdxs = seq
    .map((s, i) => (s.startsWith("db:DELETE") || s.includes("/storage/v1/object/avatars/") ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(wipeIdxs.length >= 9, `expected >= 9 wipes incl. avatar, got ${wipeIdxs.length}`);
  assert.ok(
    wipeIdxs.every((i) => i < adminIdx),
    "every wipe (DB + avatar) must precede the admin delete"
  );
  // userId-keyed wipes: gnani_daily_usage by user_key, contacts by user_id.
  assert.ok(seq.some((s) => s.includes("/rest/v1/gnani_daily_usage?user_key=eq.user%3Auser-1")));
  assert.ok(seq.some((s) => s.includes("/rest/v1/emergency_contacts?user_id=eq.user-1")));
  // Phone-keyed code rows (no user_id column on either table).
  assert.ok(seq.some((s) => s.includes("/rest/v1/signup_codes?phone=eq.%2B919876543210")));
  assert.ok(seq.some((s) => s.includes("/rest/v1/login_codes?phone=eq.%2B919876543210")));
});

test("DELETE /auth/account (F-12.3R): no profiles row → code rows still wiped via the auth user_metadata phone", async () => {
  profileRows = [];
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.url.includes("/auth/v1/user")) {
      return {
        status: 200,
        data: {
          id: "user-1",
          email: "ramesh@example.com",
          last_sign_in_at: new Date().toISOString(),
          user_metadata: { phone: "+919876543210" },
        },
      };
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
  const urls = dbCalls.map((c) => `${c.method} ${c.url}`);
  assert.ok(urls.some((u) => u.startsWith("DELETE") && u.includes("/rest/v1/signup_codes?phone=eq.%2B919876543210")));
  assert.ok(urls.some((u) => u.startsWith("DELETE") && u.includes("/rest/v1/login_codes?phone=eq.%2B919876543210")));
});

test("DELETE /auth/account (F-12.3R): a failed wipe → 502 delete-partial and the auth user is NOT deleted", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  _setDbTransport(async (call) => {
    dbCalls.push(call);
    if (call.method === "DELETE" && call.url.includes("/rest/v1/guardians?")) {
      throw new Error("guardians table down");
    }
    if (call.method === "PATCH") return { data: [{ id: "consumed" }] };
    if (call.method === "GET" && call.url.includes("/profiles?")) return { data: profileRows };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
  const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
  assert.equal(res.status, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, "delete-partial");
  assert.deepEqual(res.body.failed, ["guardians"]);
  assert.equal(
    authCalls.filter((c) => c.url.includes("/auth/v1/admin/users/user-1")).length,
    0,
    "admin delete must not run when a wipe failed"
  );
});

test("DELETE /auth/account (F-12.3R): auth unconfigured → 503 before any wipe runs", async () => {
  profileRows = [{ ...ROW, phone: "+919876543210" }];
  // Verify can still pass (anon key present) while the Admin API
  // cannot (no service-role key) — the 503 must fire pre-wipe.
  process.env.SUPABASE_ANON_KEY = "anon-key";
  setDbEnv("https://example.supabase.co", undefined);
  try {
    const res = await del("/auth/account", { ...PLAIN, Authorization: "Bearer test-token" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "Account deletion is not configured yet");
    assert.equal(
      dbCalls.filter((c) => c.method === "DELETE").length,
      0,
      "no wipe may run when deletion is unconfigured"
    );
  } finally {
    delete process.env.SUPABASE_ANON_KEY;
    setDbEnv("https://example.supabase.co", "service-role-key");
  }
});
