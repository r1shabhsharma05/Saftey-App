// 🔐 requireUser middleware tests (run-2 2.1 / 3.1, run-3 fix round 2).
// A tiny Express app mounts the middleware directly so the JWT
// verification is tested in isolation from the route table. The
// Supabase Auth REST call is faked with the _setAuthTransport seam —
// no network, no real project. The shared-key fallback
// (requireUserOrKey / requireApiKey) is DELETED in run-3 fix round
// 2: there is no compat route left to test, and a shared key alone
// must 401 on every private route.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { _setAuthTransport } = require("../services/supabaseAuth");
const { requireUser, owns } = require("../middleware/requireUser");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_ANON = process.env.SUPABASE_ANON_KEY;

const app = express();
app.get(
  "/jwt-only",
  requireUser,
  (req, res) => res.json({ success: true, user: req.user })
);

let server;
let base;
let authMode; // "ok" | "bad"

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  _setAuthTransport(null);
  if (OLD_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = OLD_URL;
  if (OLD_ANON === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = OLD_ANON;
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  authMode = "ok";
  // verifyUserToken fails closed without a URL + key, so the test
  // backend looks configured (the transport itself is still faked).
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  _setAuthTransport(async (call) => {
    if (call.url.includes("/auth/v1/user")) {
      return authMode === "ok"
        ? { status: 200, data: { id: "user-7", email: "u@example.com" } }
        : { status: 401, data: {} };
    }
    return { status: 200, data: {} };
  });
});

const get = (path, headers = {}) =>
  fetch(`${base}${path}`, { headers }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));
const KEY = { "x-api-key": "require-user-test-secret" };

test("requireUser: no token → 401; bad JWT → 401", async () => {
  assert.equal((await get("/jwt-only")).status, 401);
  authMode = "bad";
  assert.equal((await get("/jwt-only", { Authorization: "Bearer stale-jwt" })).status, 401);
});

test("requireUser: valid JWT → req.user = { id, email }", async () => {
  const res = await get("/jwt-only", { Authorization: "Bearer good-jwt" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.user, { id: "user-7", email: "u@example.com" });
});

test("requireUser: shared key alone → 401 (JWT only, no fallback)", async () => {
  assert.equal((await get("/jwt-only", KEY)).status, 401);
});

test("requireUser: stale JWT + shared key → 401 (no fall-through to the key)", async () => {
  authMode = "bad";
  assert.equal(
    (await get("/jwt-only", { Authorization: "Bearer stale-jwt", ...KEY })).status,
    401
  );
});

test("requireUserOrKey is gone: the fallback export no longer exists", () => {
  assert.equal(require("../middleware/requireUser").requireUserOrKey, undefined);
  assert.throws(() => require("../middleware/requireApiKey"), /Cannot find module/);
});

test("owns: owner match passes, foreign fails, legacy null DENIED, no-user DENIED (run-3 3.1)", () => {
  const jwt = { user: { id: "user-7" } };
  assert.equal(owns(jwt, "user-7"), true);
  assert.equal(owns(jwt, "user-9"), false);
  assert.equal(owns(jwt, null), false);
  assert.equal(owns(jwt, undefined), false);
  assert.equal(owns(jwt, ""), false);
  assert.equal(owns({}, "user-9"), false); // no req.user: deny, no compat path
  assert.equal(owns(null, "user-7"), false);
});
