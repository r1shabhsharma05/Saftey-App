// 🧪 SOS simulation suite — SafeLife 2.0 Day 6 (Phase 1 test day).
//
// What this simulates, honestly: the suite runs the REAL Express app over
// HTTP — not mocked routes — with every external dependency unconfigured
// (no Telegram, no QStash, no Upstash, no Supabase, no public URL).
// That is the current pre-blocker state of the deployment, so the
// asserts below are the behaviour a user gets when every channel is
// down: a 502 that says so, a failed alert record (never stuck in
// "dispatching"), an honest retry object, and a retry callback that
// cannot be forged.
//
// Scenarios (plan §6 D6: "offline test, server-kill test"):
//   1. Offline: all channels down → 502 + failed state + receipts.
//   2. Guards: bad coordinates 400, wrong API key 401, unknown id 404.
//   3. Retry: forged token 401, valid token re-fires a failed alert
//      (attempts bump), retry on a delivered alert is ignored, never
//      re-fired (a duplicate queue delivery must not re-spam contacts).
//   4. Server-kill: SIGKILL the process and restart it. Without the
//      pending Supabase migration the alert record lives only in the
//      killed process's memory, so the restarted server honestly
//      answers 404 — that 404 IS the finding: it is why the D3/D4
//      Supabase migration (Rishabh's step) matters. Once Supabase is
//      configured the same test expects the record back (200).
//   5. SOS rate limit: the 31st SOS inside 15 minutes is refused 429.
//      This test runs LAST: it deliberately exhausts the SOS bucket.
//
// Env is pinned at the top, BEFORE requiring the app, because
// telegram.js reads its config at module load and the rate limiter
// picks its store at require time. The suite must not depend on
// whatever happens to be in the shell that runs it.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const SUPABASE_CONFIGURED = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const supabaseEnv = SUPABASE_CONFIGURED
  ? {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
  : {};

process.env.API_SECRET = "d6-sim-secret";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
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
const alertStore = require("../services/alertStore");
const { createAlert, transition } = require("../services/alertLifecycle");
const { retryToken } = require("../services/delivery");

const KEY = "d6-sim-secret";
const SOS_BODY = {
  lat: 28.6139,
  lng: 77.209,
  name: "Sim User",
  phone: "0000000000",
  battery: "42%",
  status: "Stationary",
  nearestStation: "Sim Station",
  contacts: [],
};

let server;
let base;
let sosPosts = 0;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = async (url, body, key = KEY) =>
  fetch(`${base}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });

const postSos = async (body = SOS_BODY, key = KEY) => {
  sosPosts += 1;
  return post("/alert", body, key);
};

const getAlert = async (id, key = KEY) =>
  fetch(`${base}/alert/${id}`, { headers: { "x-api-key": key } });

test("offline: all channels down → 502, failed state, honest receipts", async () => {
  const res = await postSos();
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.ok(body.alertId, "a failed SOS still gets an alert id");
  assert.equal(body.state, "failed", "never stuck in dispatching");
  assert.equal(body.delivery.length, 4);
  for (const receipt of body.delivery) {
    assert.equal(receipt.state, "failed");
    assert.equal(receipt.sent, 0);
  }
  assert.deepEqual(
    body.delivery.map((r) => r.channel),
    ["telegram", "sms", "whatsapp", "push"]
  );
  // Stubs say so; Telegram-disabled has no reason field, only a count.
  assert.equal(
    body.delivery.find((r) => r.channel === "sms").reason,
    "channel-not-configured"
  );
  // No signing path is complete without a public URL, and the response
  // must say that instead of pretending a retry is scheduled.
  assert.deepEqual(body.retry, { queued: false, reason: "no-public-url" });

  const read = await getAlert(body.alertId);
  assert.equal(read.status, 200);
  const readBody = await read.json();
  assert.equal(readBody.alert.state, "failed");
  assert.deepEqual(readBody.alert.delivery, body.delivery);
  return body.alertId;
});

test("guards: bad coordinates 400, wrong key 401, unknown alert 404", async () => {
  const bad = await postSos({ ...SOS_BODY, lat: 9999 });
  assert.equal(bad.status, 400);
  const wrongKey = await postSos(SOS_BODY, "not-the-key");
  assert.equal(wrongKey.status, 401);
  const missing = await getAlert("00000000-0000-0000-0000-000000000000");
  assert.equal(missing.status, 404);
});

test("retry: forged token 401, valid token re-fires, delivered alert ignored", async () => {
  // Re-create the offline failure so this test owns its fixture.
  const sos = await postSos();
  const failed = await sos.json();
  const alertId = failed.alertId;
  assert.equal(failed.state, "failed");

  const forged = await post("/delivery-retry", {
    alertId,
    attempt: 1,
    token: "0".repeat(64),
    message: "SOS",
  });
  assert.equal(forged.status, 401);

  const retry = await post("/delivery-retry", {
    alertId,
    attempt: 1,
    token: retryToken(alertId, 1),
    message: "SOS",
  });
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.state, "failed", "re-dispatch still fails: channels down");
  assert.equal(
    retryBody.delivery.find((r) => r.channel === "telegram").attempts,
    2,
    "a retry bumps the attempt count instead of overwriting history"
  );
  assert.deepEqual(retryBody.retry, { queued: false, reason: "no-public-url" });

  // Idempotency: a retry arriving for an already-delivered alert must
  // not re-fire the SOS (duplicate queue delivery → false alarm).
  const delivered = createAlert({ contactsCount: 0 });
  transition(delivered, "dispatching");
  transition(delivered, "delivered");
  alertStore.save(delivered);
  const ignored = await post("/delivery-retry", {
    alertId: delivered.id,
    attempt: 1,
    token: retryToken(delivered.id, 1),
    message: "SOS",
  });
  assert.equal(ignored.status, 200);
  const ignoredBody = await ignored.json();
  assert.equal(ignoredBody.ignored, true);
  assert.equal(ignoredBody.state, "delivered");
});

// --- Server-kill test: a real child process, SIGKILLed and restarted. ---
const childEnv = (port) => ({
  ...process.env,
  API_SECRET: KEY,
  PORT: String(port),
  ...supabaseEnv,
});

const waitReady = async (port, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server on port ${port} did not become ready`);
};

const spawnServer = (port) =>
  spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: childEnv(port),
    stdio: ["ignore", "pipe", "pipe"],
  });

const killAndWait = (child) =>
  new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });

test("server-kill: restart loses the memory-only alert until Supabase lands", async () => {
  const port = 45931;
  let child = spawnServer(port);
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  try {
    await waitReady(port);
    const sos = await fetch(`http://127.0.0.1:${port}/alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY },
      body: JSON.stringify(SOS_BODY),
    });
    assert.equal(sos.status, 502);
    const { alertId } = await sos.json();

    await killAndWait(child);
    child = spawnServer(port);
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    await waitReady(port);

    const read = await fetch(`http://127.0.0.1:${port}/alert/${alertId}`, {
      headers: { "x-api-key": KEY },
    });
    if (SUPABASE_CONFIGURED) {
      // Shared store: the record survives the kill.
      assert.equal(read.status, 200);
      assert.equal((await read.json()).alert.state, "failed");
    } else {
      // Memory-only store: the restarted process honestly has no record.
      // This 404 is the D3/D4 migration gap, asserted, not hidden.
      assert.equal(read.status, 404);
    }

    // The restarted server still answers SOS honestly (recovered, not wedged).
    const again = await fetch(`http://127.0.0.1:${port}/alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY },
      body: JSON.stringify(SOS_BODY),
    });
    assert.equal(again.status, 502);
  } finally {
    if (child.exitCode === null) await killAndWait(child);
  }
});

test("SOS rate limit: the 31st SOS in 15 minutes is refused 429 (runs last)", async () => {
  // The limiter counts every POST /alert that reaches it, including the
  // 400/401 above — sosPosts tracks exactly that.
  const remaining = 30 - sosPosts;
  assert.ok(remaining > 0, `expected SOS budget left, used ${sosPosts}`);
  for (let i = 0; i < remaining; i++) {
    const res = await postSos();
    assert.equal(res.status, 502);
  }
  const over = await postSos();
  assert.equal(over.status, 429);
  const body = await over.json();
  assert.equal(body.success, false);
  assert.match(body.error, /Too many requests/);
});
