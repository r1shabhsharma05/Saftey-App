// 📧 Login-resolve route tests — phone → account email.
// Real Express app over HTTP with a fake Supabase transport (the
// _setDbTransport seam): no network, no real project. The endpoint
// returns ONLY the email — a test asserts nothing else leaks — and a
// phone with no account gets the same generic 404 as any other miss.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { _setDbTransport } = require("../services/supabaseDb");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const setDbEnv = (url, key) => {
  if (url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
};

const app = require("../server");

const PLAIN = { "Content-Type": "application/json" };
const PHONE = "+919876543210";
const ROW = {
  id: "user-1",
  first_name: "Ramesh",
  last_name: "Kumar",
  phone: "+919876543210",
  email: "ramesh@example.com",
};

let server;
let base;
let calls;
let exactRows;
let suffixRows;
let failTransport;

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
  calls = [];
  exactRows = [];
  suffixRows = [];
  failTransport = false;
  _setDbTransport(async (call) => {
    calls.push(call);
    if (failTransport) throw new Error("db down");
    // Audit mirror POSTs flow through the same transport — answer
    // them harmlessly; only GETs carry the profile lookup.
    if (call.method !== "GET") return { data: null };
    const rows = call.url.includes("like.") ? suffixRows : exactRows;
    return { data: rows };
  });
});
after(() => {
  _setDbTransport(null);
  setDbEnv(OLD_URL, OLD_KEY);
});

const post = (path, body, headers = PLAIN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const resolve = (phone = PHONE) => post("/auth/login/resolve", { phone });
const getCalls = () => calls.filter((c) => c.method === "GET");

test("POST /auth/login/resolve: invalid phone → 400", async () => {
  assert.equal((await resolve("junk")).status, 400);
  assert.equal((await resolve("")).status, 400);
});

test("POST /auth/login/resolve: DB unconfigured → 503", async () => {
  setDbEnv(undefined, undefined);
  const res = await resolve();
  assert.equal(res.status, 503);
  assert.match(res.body.error, /not configured/);
});

test("POST /auth/login/resolve: no match → 404 generic, nothing leaks", async () => {
  const res = await resolve();
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Account not found");
  assert.equal(getCalls().length, 2); // exact, then suffix fallback
});

test("POST /auth/login/resolve: exact match → 200 with ONLY the email", async () => {
  exactRows = [ROW];
  const res = await resolve();
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.email, "ramesh@example.com");
  assert.deepEqual(Object.keys(res.body).sort(), ["email", "success"]);
  assert.equal(JSON.stringify(res.body).includes("Ramesh"), false);
  assert.equal(JSON.stringify(res.body).includes(PHONE), false);
  // Exact match short-circuits: no suffix lookup.
  assert.equal(getCalls().length, 1);
  assert.ok(getCalls()[0].url.includes("phone=eq.%2B919876543210"));
});

test("POST /auth/login/resolve: exact miss + suffix hit → 200 (phone saved as typed)", async () => {
  suffixRows = [{ ...ROW, phone: "98765 43210" }];
  const res = await resolve();
  assert.equal(res.status, 200);
  assert.equal(res.body.email, "ramesh@example.com");
  assert.equal(getCalls().length, 2);
  assert.ok(getCalls()[1].url.includes("like."));
  assert.ok(getCalls()[1].url.includes("9876543210"));
});

test("POST /auth/login/resolve: row without a valid email → 404", async () => {
  exactRows = [{ ...ROW, email: "not-an-email" }];
  assert.equal((await resolve()).status, 404);
  exactRows = [{ ...ROW, email: undefined }];
  assert.equal((await resolve()).status, 404);
});

test("POST /auth/login/resolve: DB transport error → 502, not a 404", async () => {
  failTransport = true;
  const res = await resolve();
  assert.equal(res.status, 502);
  assert.match(res.body.error, /Could not look up/);
});
