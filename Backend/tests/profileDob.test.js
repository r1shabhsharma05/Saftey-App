// 📅 POST /auth/profile/dob tests — Google-signup age-gate backfill (H15).
// Google OAuth creates the Supabase account directly, so
// signup/complete's DOB check never runs for those users; this endpoint
// lets the app set the DOB (once) after Google sign-up. Real Express
// app over HTTP; the Supabase Auth REST transport is faked in-process
// (same seam as tests/jwtAuth.js) with a mutable user_metadata DOB so
// the already-set paths are exercisable. Admin PUT calls are captured
// to prove the metadata write happened (or did not).
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "profile-dob-test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

const app = require("../server");
const { _setAuthTransport } = require("../services/supabaseAuth");

const HEADERS = { "Content-Type": "application/json", Authorization: "Bearer test-token" };
const PLAIN = { "Content-Type": "application/json" };

// The DOB currently on the fake auth user's user_metadata (null = unset).
let currentDob = null;
// Every Auth REST call the route/service made, in order.
let authCalls = [];

const installTransport = () => {
  _setAuthTransport(async (call) => {
    authCalls.push(call);
    if (call.method === "GET" && call.url.includes("/auth/v1/user")) {
      const token = (call.headers?.Authorization || "").replace(/^Bearer\s+/, "");
      if (token !== "test-token") return { status: 401, data: {} };
      return {
        status: 200,
        data: {
          id: "test-user",
          email: "test@example.com",
          last_sign_in_at: new Date().toISOString(),
          user_metadata: currentDob ? { date_of_birth: currentDob } : {},
        },
      };
    }
    if (call.method === "PUT" && call.url.includes("/auth/v1/admin/users/")) {
      return { status: 200, data: {} };
    }
    return { status: 200, data: {} };
  });
};

const adminPuts = () =>
  authCalls.filter((c) => c.method === "PUT" && c.url.includes("/auth/v1/admin/users/"));

let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  _setAuthTransport(null);
});
beforeEach(() => {
  currentDob = null;
  authCalls = [];
  installTransport();
});

const post = (body, headers = HEADERS) =>
  fetch(`${base}/auth/profile/dob`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test("POST /auth/profile/dob: no auth → 401; bad token → 401", async () => {
  assert.equal((await post({ dateOfBirth: "2000-05-21" }, PLAIN)).status, 401);
  assert.equal(
    (await post({ dateOfBirth: "2000-05-21" }, { ...PLAIN, Authorization: "Bearer wrong-token" })).status,
    401
  );
  assert.equal(adminPuts().length, 0);
});

test("POST /auth/profile/dob: under-13 → 400, no admin write", async () => {
  const res = await post({ dateOfBirth: "2015-06-15" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /at least 13/);
  assert.equal(adminPuts().length, 0);
});

test("POST /auth/profile/dob: invalid date → 400, no admin write", async () => {
  for (const bad of ["2020-02-30", "not-a-date", "", "21-05-2000"]) {
    const res = await post({ dateOfBirth: bad });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /valid date of birth/);
  }
  assert.equal(adminPuts().length, 0);
});

test("POST /auth/profile/dob: valid DOB, none set → 200 { ok: true } + admin metadata write", async () => {
  const res = await post({ dateOfBirth: "2000-05-21" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const puts = adminPuts();
  assert.equal(puts.length, 1);
  assert.ok(puts[0].url.includes("/auth/v1/admin/users/test-user"));
  assert.deepEqual(puts[0].body, { user_metadata: { date_of_birth: "2000-05-21" } });
});

test("POST /auth/profile/dob: DOB already set to a different value → 400, no admin write", async () => {
  currentDob = "2000-01-01";
  const res = await post({ dateOfBirth: "1999-12-31" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /already set/);
  assert.equal(adminPuts().length, 0);
});

test("POST /auth/profile/dob: DOB already set to the identical value → 200 idempotent, no admin write", async () => {
  currentDob = "2000-01-01";
  const res = await post({ dateOfBirth: "2000-01-01" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(adminPuts().length, 0);
});
