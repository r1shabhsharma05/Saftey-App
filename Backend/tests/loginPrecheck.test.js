// 🔑 Login precheck tests (run-3 fix round 2, 2.4).
// POST /auth/login/precheck {email} — per-email attempt limiter in
// front of password login. Real Express app over HTTP; the limiter
// is in-memory here (no Upstash env), which is the same code path
// the shared store falls back to.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

const { _clearPrecheck } = require("../services/loginPrecheck");

const app = require("../server");

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

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test("precheck: fresh email → 200 {allowed:true}; invalid email → 400", async () => {
  _clearPrecheck();
  const res = await post("/auth/login/precheck", { email: "ramesh@example.com" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { allowed: true });
  assert.equal((await post("/auth/login/precheck", { email: "not-an-email" })).status, 400);
  assert.equal((await post("/auth/login/precheck", {})).status, 400);
});

test("precheck: 11th attempt in 15 min → 429 {allowed:false, retryAfterSeconds}; other emails unaffected", async () => {
  _clearPrecheck();
  const email = "hammered@example.com";
  for (let i = 0; i < 10; i++) {
    const res = await post("/auth/login/precheck", { email });
    assert.equal(res.status, 200);
    assert.equal(res.body.allowed, true);
  }
  const blocked = await post("/auth/login/precheck", { email });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.allowed, false);
  assert.equal(typeof blocked.body.retryAfterSeconds, "number");
  assert.ok(blocked.body.retryAfterSeconds > 0);
  // A different email has its own bucket.
  const other = await post("/auth/login/precheck", { email: "someone-else@example.com" });
  assert.equal(other.status, 200);
  assert.equal(other.body.allowed, true);
  _clearPrecheck();
});

test("precheck: email is case/whitespace-insensitive (same bucket); existence never leaks", async () => {
  _clearPrecheck();
  // 10 attempts under mixed casings all land in one bucket.
  for (let i = 0; i < 10; i++) {
    await post("/auth/login/precheck", { email: i % 2 ? "  Mixed@Example.com " : "mixed@example.com" });
  }
  const blocked = await post("/auth/login/precheck", { email: "MIXED@example.com" });
  assert.equal(blocked.status, 429);
  // Registered and unregistered emails answer identically while allowed.
  const a = await post("/auth/login/precheck", { email: "nobody-at-all@example.com" });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, { allowed: true });
  _clearPrecheck();
});
