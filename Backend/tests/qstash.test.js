// Unit tests for services/qstash.js — the D2 QStash wiring.
// Fake env + fake transport: no network, no real QStash account needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.QSTASH_TOKEN = "fake-qstash-token";

const {
  qstashStatus,
  publishDelayed,
  _setQstashTransport,
} = require("../services/qstash");

const sent = [];
_setQstashTransport(async (job) => {
  sent.push(job);
  return { messageId: "msg_123" };
});

test("qstashStatus reports configured, never the token", () => {
  const st = qstashStatus();
  assert.equal(st.configured, true);
  assert.ok(!JSON.stringify(st).includes("fake-qstash-token"));
});

test("publishDelayed sends destination, delay and body to the transport", async () => {
  const res = await publishDelayed({
    url: "https://example.com/internal/escalate",
    body: { alertId: "a1" },
    delaySeconds: 60,
    deduplicationId: "alert-a1-step-2",
  });
  assert.deepEqual(res, { queued: true, messageId: "msg_123" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://example.com/internal/escalate");
  assert.equal(sent[0].delaySeconds, 60);
  assert.deepEqual(sent[0].body, { alertId: "a1" });
  assert.equal(sent[0].deduplicationId, "alert-a1-step-2");
});

test("publishDelayed validates url and delay at the boundary", async () => {
  await assert.rejects(
    publishDelayed({ url: "not-a-url", body: {}, delaySeconds: 60 }),
    TypeError
  );
  await assert.rejects(
    publishDelayed({ url: "https://example.com/x", body: {}, delaySeconds: 0 }),
    TypeError
  );
  await assert.rejects(
    publishDelayed({ url: "https://example.com/x", body: {}, delaySeconds: 1.5 }),
    TypeError
  );
});

test("unconfigured publish returns queued:false and never calls transport", async () => {
  delete process.env.QSTASH_TOKEN;
  try {
    const before = sent.length;
    const res = await publishDelayed({
      url: "https://example.com/x",
      body: {},
      delaySeconds: 60,
    });
    assert.deepEqual(res, { queued: false, reason: "not-configured" });
    assert.equal(sent.length, before);
    assert.equal(qstashStatus().configured, false);
  } finally {
    process.env.QSTASH_TOKEN = "fake-qstash-token";
  }
});

test("transport failure returns queued:false, never throws", async () => {
  _setQstashTransport(async () => {
    throw new Error("boom");
  });
  try {
    const res = await publishDelayed({
      url: "https://example.com/x",
      body: {},
      delaySeconds: 60,
    });
    assert.deepEqual(res, { queued: false, reason: "transport-error" });
  } finally {
    _setQstashTransport(async (job) => {
      sent.push(job);
      return { messageId: "msg_123" };
    });
  }
});
