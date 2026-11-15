// 🔐 requireUser middleware tests (run-2 2.1 / 3.1).
// A tiny Express app mounts the middleware directly so the JWT
// verification and the shared-key compat fallback are tested in
// isolation from the route table. The Supabase Auth REST call is
// faked with the _setAuthTransport seam — no network, no real project.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { _setAuthTransport } = require("../services/supabaseAuth");
const { requireUser, requireUserOrKey, owns } = require("../middleware/requireUser");
const { _setWriteSink } = require("../services/audit");

process.env.API_SECRET = "require-user-test-secret";
const OLD_URL = process.env.SUPABASE_URL;
const OLD_ANON = process.env.SUPABASE_ANON_KEY;

const app = express();
app.get(
  "/jwt-only",
  requireUser,
  (req, res) => res.json({ success: true, user: req.user })
);
app.get(
  "/compat",
  requireUserOrKey,
  (req, res) => res.json({ success: true, user: req.user || null })
);

let server;
let base;
let auditLines;
let authMode; // "ok" | "bad"

before(async () => {
  _setWriteSink((line) => auditLines.push(line));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  _setWriteSink((line) => process.stdout.write(line + "\n"));
  _setAuthTransport(null);
  if (OLD_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = OLD_URL;
  if (OLD_ANON === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = OLD_ANON;
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  auditLines = [];
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

test("requireUserOrKey: no token, no key → 401", async () => {
  assert.equal((await get("/compat")).status, 401);
});

test("requireUserOrKey: valid JWT wins, no fallback audit line", async () => {
  const res = await get("/compat", { Authorization: "Bearer good-jwt" });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, "user-7");
  assert.equal(auditLines.some((l) => l.includes("auth.shared_key_fallback")), false);
});

test("requireUserOrKey: shared key alone → 200 with null user + audit line (compat fallback)", async () => {
  const res = await get("/compat", KEY);
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
  assert.equal(auditLines.some((l) => l.includes("auth.shared_key_fallback")), true);
});

test("requireUserOrKey: stale JWT + valid key → falls through to the key, 200", async () => {
  authMode = "bad";
  const res = await get("/compat", { Authorization: "Bearer stale-jwt", ...KEY });
  assert.equal(res.status, 200);
  assert.equal(res.body.user, null);
});

test("requireUserOrKey: bad JWT + bad key → 401", async () => {
  authMode = "bad";
  assert.equal(
    (await get("/compat", { Authorization: "Bearer stale-jwt", "x-api-key": "wrong" })).status,
    401
  );
});

test("owns: owner match passes, foreign fails, legacy null passes, key-only caller passes", () => {
  const jwt = { user: { id: "user-7" } };
  assert.equal(owns(jwt, "user-7"), true);
  assert.equal(owns(jwt, "user-9"), false);
  assert.equal(owns(jwt, null), true);
  assert.equal(owns(jwt, undefined), true);
  assert.equal(owns({}, "user-9"), true); // compat caller: no req.user
});
