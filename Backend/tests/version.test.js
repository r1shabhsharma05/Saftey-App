// 📱 GET /version (H18, force-update contract) — public, no auth.
// Exact shape: { minSupportedVersion, latestVersion }. Env-driven:
// MIN_SUPPORTED_APP_VERSION (default 1.0.0), LATEST_APP_VERSION
// (default = min). Real Express app over HTTP, no network.
const test = require("node:test");
const { before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");

let server;
let base;

const OLD_MIN = process.env.MIN_SUPPORTED_APP_VERSION;
const OLD_LATEST = process.env.LATEST_APP_VERSION;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  delete process.env.MIN_SUPPORTED_APP_VERSION;
  delete process.env.LATEST_APP_VERSION;
});
afterEach(() => {
  if (OLD_MIN === undefined) delete process.env.MIN_SUPPORTED_APP_VERSION;
  else process.env.MIN_SUPPORTED_APP_VERSION = OLD_MIN;
  if (OLD_LATEST === undefined) delete process.env.LATEST_APP_VERSION;
  else process.env.LATEST_APP_VERSION = OLD_LATEST;
});

const getVersion = () =>
  fetch(`${base}/version`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test("GET /version: no env → both default to 1.0.0, exact keys, no auth needed", async () => {
  const res = await getVersion();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { minSupportedVersion: "1.0.0", latestVersion: "1.0.0" });
  assert.deepEqual(Object.keys(res.body).sort(), ["latestVersion", "minSupportedVersion"]);
});

test("GET /version: env values are returned verbatim", async () => {
  process.env.MIN_SUPPORTED_APP_VERSION = "1.2.0";
  process.env.LATEST_APP_VERSION = "2.0.0";
  const res = await getVersion();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { minSupportedVersion: "1.2.0", latestVersion: "2.0.0" });
});

test("GET /version: LATEST_APP_VERSION unset → latest defaults to min", async () => {
  process.env.MIN_SUPPORTED_APP_VERSION = "1.5.3";
  const res = await getVersion();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { minSupportedVersion: "1.5.3", latestVersion: "1.5.3" });
});
