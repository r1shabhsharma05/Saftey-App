const test = require("node:test");
const assert = require("node:assert/strict");

const {
  nextRetryDelay,
  MAX_RETRIES,
  deliverAlert,
  receiptsSummary,
  applyRetryReceipts,
  retryToken,
  verifyRetryToken,
  scheduleRetry,
} = require("../services/delivery");

test("nextRetryDelay: 30s, 120s, 300s, then null", () => {
  assert.equal(nextRetryDelay(1), 30);
  assert.equal(nextRetryDelay(2), 120);
  assert.equal(nextRetryDelay(3), 300);
  assert.equal(nextRetryDelay(4), null);
  assert.equal(MAX_RETRIES, 3);
});

test("deliverAlert: parallel fan-out, per-channel receipts, partial state", async () => {
  const senders = {
    telegram: async () => ({ sent: 1, failed: 0 }),
    sms: async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" }),
    whatsapp: async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" }),
    push: async () => ({ sent: 0, failed: 1, reason: "channel-not-configured" }),
  };
  const receipts = await deliverAlert({ message: "SOS", senders });
  assert.equal(receipts.length, 4);
  assert.equal(receipts[0].channel, "telegram");
  assert.equal(receipts[0].state, "delivered");
  assert.equal(receipts[1].state, "failed");
  assert.equal(receipts[1].reason, "channel-not-configured");
  const { sent, failed } = receiptsSummary(receipts);
  assert.equal(sent, 1);
  assert.equal(failed, 3);
});

test("deliverAlert: a throwing adapter becomes a failed receipt, not a throw", async () => {
  const senders = {
    telegram: async () => {
      throw new Error("boom");
    },
    sms: async () => ({ sent: 0, failed: 1 }),
    whatsapp: async () => ({ sent: 0, failed: 1 }),
    push: async () => ({ sent: 0, failed: 1 }),
  };
  const receipts = await deliverAlert({ message: "SOS", senders });
  assert.equal(receipts[0].state, "failed");
  assert.equal(receipts[0].reason, "transport-error");
});

test("applyRetryReceipts: replaces per-channel state, bumps attempts", () => {
  const oldReceipts = [
    { channel: "telegram", state: "failed", sent: 0, failed: 1, attempts: 1 },
    { channel: "sms", state: "failed", sent: 0, failed: 1, attempts: 1 },
    { channel: "whatsapp", state: "failed", sent: 0, failed: 1, attempts: 1 },
    { channel: "push", state: "failed", sent: 0, failed: 1, attempts: 1 },
  ];
  const fresh = [
    { channel: "telegram", state: "delivered", sent: 1, failed: 0, attempts: 1 },
    { channel: "sms", state: "failed", sent: 0, failed: 1, attempts: 1 },
    { channel: "whatsapp", state: "failed", sent: 0, failed: 1, attempts: 1 },
    { channel: "push", state: "failed", sent: 0, failed: 1, attempts: 1 },
  ];
  const merged = applyRetryReceipts(oldReceipts, fresh);
  assert.equal(merged[0].state, "delivered");
  assert.equal(merged[0].attempts, 2);
  assert.equal(merged[1].attempts, 2);
});

test("retryToken: verifies, rejects tampered attempt and token", () => {
  const prev = process.env.API_SECRET;
  process.env.API_SECRET = "test-secret";
  try {
    const token = retryToken("alert-1", 1);
    assert.ok(token);
    assert.ok(verifyRetryToken("alert-1", 1, token));
    assert.ok(!verifyRetryToken("alert-1", 2, token));
    assert.ok(!verifyRetryToken("alert-1", 1, "0".repeat(token.length)));
    assert.ok(!verifyRetryToken("alert-1", 1, undefined));
  } finally {
    if (prev === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = prev;
  }
});

test("retryToken: null without a signing secret", () => {
  const prev = process.env.API_SECRET;
  delete process.env.API_SECRET;
  try {
    assert.equal(retryToken("alert-1", 1), null);
    assert.equal(verifyRetryToken("alert-1", 1, "anything"), false);
  } finally {
    if (prev !== undefined) process.env.API_SECRET = prev;
  }
});

test("scheduleRetry: no-public-url beats publish when no base URL is known", async () => {
  const prevSecret = process.env.API_SECRET;
  const prevBase = process.env.PUBLIC_BASE_URL;
  const prevVercel = process.env.VERCEL_URL;
  process.env.API_SECRET = "test-secret";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.VERCEL_URL;
  try {
    const res = await scheduleRetry({ alertId: "alert-1", attempt: 1, message: "SOS" });
    assert.deepEqual(res, { queued: false, reason: "no-public-url" });
  } finally {
    if (prevSecret === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = prevSecret;
    if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevBase;
    if (prevVercel === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = prevVercel;
  }
});

test("scheduleRetry: no-more-retries past the last attempt", async () => {
  const res = await scheduleRetry({ alertId: "alert-1", attempt: 99, message: "SOS" });
  assert.deepEqual(res, { queued: false, reason: "no-more-retries" });
});
