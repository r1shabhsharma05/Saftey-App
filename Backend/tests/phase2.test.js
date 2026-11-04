// 🧪 Phase 2 test — SafeLife 2.0 Day 12 (plan §6 D12: "chaaro channels
// end-to-end, ek channel band karke chaos test, security check").
//
// What this proves, honestly: the four channels fan out in parallel and
// one channel failing — returning failure OR throwing — never kills the
// other three, never re-fires a delivered channel, and never leaves a
// receipt lying. The fan-out legs use INJECTED senders, because no
// channel can be configured honestly in this process: SMS/WhatsApp/
// push/voice have no credentials here (standing blockers), and the
// real adapters are pinned unconfigured below, so no external call can
// leave the process. The per-adapter request shapes are already proven
// by the D7–D10 mocked-fetch tests; the all-down HTTP contract is
// proven by the D6 simulation suite; the battery chaos leg (all
// channels down → 502, no ladder/retry) is proven by batteryRoutes.
// This file adds the missing leg: one channel down, the rest up.
//
// The HTTP legs run the REAL Express app with every external dependency
// unconfigured and the fail-closed premises pinned (no CORS allowlist,
// test-alert off, API_SECRET set): /health must tell the unconfigured
// truth without leaking the secret, the debug route must stay 404, and
// the escalation callback must re-fire only the failed channels when
// every channel is down.
//
// Env is pinned BEFORE requiring the app, as in the simulation suite:
// adapters read config at module load and limiters pick their store
// at require time. This file must not depend on the shell running it.
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d12-phase2-secret";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_TEMPLATE_LANGUAGE",
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
  "CORS_ALLOWED_ORIGINS",
  "ENABLE_TEST_ALERT",
]) {
  delete process.env[v];
}

const app = require("../server");
const alertStore = require("../services/alertStore");
const { createAlert, transition } = require("../services/alertLifecycle");
const { escalationToken, failedChannels } = require("../services/escalation");
const {
  CHANNELS,
  deliverAlert,
  receiptsSummary,
  applyRetryReceipts,
} = require("../services/delivery");

const KEY = "d12-phase2-secret";
const CONTACTS = [{ name: "Mom", phone: "+919999999999", pushToken: "tok-1" }];

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

// --- Fan-out: all four channels, injected senders -----------------------

const okSenders = (counts = {}) => {
  const calls = {};
  const senders = {};
  for (const channel of CHANNELS) {
    calls[channel] = 0;
    senders[channel] = async ({ message, contacts }) => {
      calls[channel] += 1;
      assert.equal(message, "SOS");
      assert.deepEqual(contacts, CONTACTS);
      return { sent: counts[channel] ?? 1, failed: 0 };
    };
  }
  return { senders, calls };
};

test("four channels end-to-end: all succeed → all delivered, in order, counts honest", async () => {
  const { senders, calls } = okSenders({ telegram: 1, sms: 2, whatsapp: 2, push: 2 });
  const receipts = await deliverAlert({ message: "SOS", contacts: CONTACTS, senders });
  assert.deepEqual(
    receipts.map((r) => r.channel),
    ["telegram", "sms", "whatsapp", "push"]
  );
  assert.ok(receipts.every((r) => r.state === "delivered" && r.attempts === 1));
  assert.deepEqual(
    receipts.map((r) => r.sent),
    [1, 2, 2, 2]
  );
  assert.deepEqual(receiptsSummary(receipts), { sent: 7, failed: 0 });
  assert.deepEqual(calls, { telegram: 1, sms: 1, whatsapp: 1, push: 1 });
});

test("chaos: each channel down in turn → the other three still deliver", async () => {
  for (const down of CHANNELS) {
    const { senders } = okSenders();
    senders[down] = async () => ({ sent: 0, failed: 2, reason: "channel-not-configured" });
    const receipts = await deliverAlert({ message: "SOS", contacts: CONTACTS, senders });
    const failed = receipts.find((r) => r.channel === down);
    assert.equal(failed.state, "failed");
    assert.equal(failed.reason, "channel-not-configured");
    for (const r of receipts.filter((r) => r.channel !== down)) {
      assert.equal(r.state, "delivered", `${r.channel} must survive ${down} being down`);
    }
    assert.deepEqual(receiptsSummary(receipts), { sent: 3, failed: 2 });
  }
});

test("chaos: a throwing channel becomes transport-error, never a throw", async () => {
  for (const down of CHANNELS) {
    const { senders } = okSenders();
    senders[down] = async () => {
      throw new Error("boom");
    };
    const receipts = await deliverAlert({ message: "SOS", contacts: CONTACTS, senders });
    const failed = receipts.find((r) => r.channel === down);
    assert.equal(failed.state, "failed");
    assert.equal(failed.reason, "transport-error");
    assert.equal(failed.sent, 0);
    assert.ok(receipts.filter((r) => r.channel !== down).every((r) => r.state === "delivered"));
  }
});

test("escalation narrowing: delivered channels are never re-fired", async () => {
  const seed = [
    { channel: "telegram", state: "delivered", sent: 1, failed: 0, attempts: 1 },
    { channel: "sms", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
    { channel: "whatsapp", state: "partial", sent: 1, failed: 1, attempts: 1 },
    { channel: "push", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
  ];
  assert.deepEqual(failedChannels(seed), ["sms", "whatsapp", "push"]);
  const { senders, calls } = okSenders();
  senders.push = async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" });
  const fresh = await deliverAlert({
    message: "SOS",
    contacts: CONTACTS,
    senders,
    channels: failedChannels(seed),
  });
  assert.deepEqual(
    fresh.map((r) => r.channel),
    ["sms", "whatsapp", "push"]
  );
  assert.equal(calls.telegram, 0, "a delivered channel must not be re-sent");
  const merged = applyRetryReceipts(seed, fresh);
  assert.equal(merged.find((r) => r.channel === "telegram").attempts, 1);
  assert.equal(merged.find((r) => r.channel === "telegram").state, "delivered");
  assert.equal(merged.find((r) => r.channel === "sms").attempts, 2);
  assert.equal(merged.find((r) => r.channel === "sms").state, "delivered");
  assert.equal(merged.find((r) => r.channel === "push").attempts, 2);
  assert.equal(merged.find((r) => r.channel === "push").state, "failed");
});

// --- HTTP: the deployed shape under chaos -------------------------------

test("health: unconfigured truth, no secret leak, no route map", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "OK");
  for (const channel of ["telegram", "sms", "whatsapp", "push", "voice"]) {
    assert.equal(body.config[channel].configured, false, `${channel} must report unconfigured`);
  }
  assert.equal(body.config.apiKeyEnforced, true);
  assert.equal(body.config.upstash.configured, false);
  assert.equal(body.config.qstash.configured, false);
  assert.equal(body.config.supabase.configured, false);
  assert.ok(!JSON.stringify(body).includes(KEY), "the secret must never appear in /health");

  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200);
  const rootBody = await root.json();
  assert.equal(rootBody.status, "online");
  assert.ok(!JSON.stringify(rootBody).includes("/delivery-retry"), "no endpoint map for reconnaissance");
  assert.ok(!JSON.stringify(rootBody).includes("/test-alert"));
});

test("security headers + JSON 404 + CORS fail-closed (no allowlist set)", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-powered-by"), null);

  const missing = await fetch(`${base}/no-such-route`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /application\/json/);
  const missingBody = await missing.json();
  assert.equal(missingBody.error, "Not found");
  assert.ok(!JSON.stringify(missingBody).includes("stack"));

  const preflight = await fetch(`${base}/health`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

test("test-alert stays off by default: 404 with or without the key", async () => {
  for (const headers of [{ "x-api-key": KEY }, {}]) {
    const res = await fetch(`${base}/test-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Not found");
  }
});

test("safe-places guard: invalid coordinates → 400, no upstream call", async () => {
  const res = await fetch(`${base}/safe-places?lat=999&lng=77`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Invalid coordinates");
});

test("escalation chaos: step 1 with every channel down re-fires only the failed ones", async () => {
  const alert = createAlert({ contactsCount: 1 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alert.delivery = [
    { channel: "telegram", state: "delivered", sent: 1, failed: 0, attempts: 1 },
    { channel: "sms", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
    { channel: "whatsapp", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
    { channel: "push", state: "failed", sent: 0, failed: 1, attempts: 1, reason: "channel-not-configured" },
  ];
  alertStore.save(alert);
  const run = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id,
      step: 1,
      token: escalationToken(alert.id, 1),
      message: "SOS",
      contacts: ["+919999999999"],
      pushTokens: ["tok-1"],
    }),
  });
  assert.equal(run.status, 200);
  const runBody = await run.json();
  assert.equal(runBody.state, "delivered");
  assert.equal(runBody.escalation.runs.length, 1);
  assert.equal(runBody.escalation.runs[0].action, "refire-failed-channels");
  assert.deepEqual(runBody.escalation.runs[0].channels, ["sms", "whatsapp", "push"]);
  assert.equal(runBody.delivery.find((r) => r.channel === "telegram").attempts, 1);
  for (const channel of ["sms", "whatsapp", "push"]) {
    assert.equal(runBody.delivery.find((r) => r.channel === channel).attempts, 2);
    assert.equal(runBody.delivery.find((r) => r.channel === channel).state, "failed");
  }

  const dup = await fetch(`${base}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      alertId: alert.id,
      step: 1,
      token: escalationToken(alert.id, 1),
      message: "SOS",
      contacts: [],
      pushTokens: [],
    }),
  });
  assert.equal((await dup.json()).ignored, true, "a redelivered step must not re-fire");
});
