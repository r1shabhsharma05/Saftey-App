// Unit tests for services/telegram.js — the disabled path must answer
// honestly instead of pretending to send.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Force the disabled path regardless of the ambient environment.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_IDS;

const { sendTelegramMessage, telegramStatus } = require("../services/telegram");

test("disabled telegram returns failed=1, sent=0 without network", async () => {
  const result = await sendTelegramMessage("hello");
  assert.deepEqual(result, { sent: 0, failed: 1 });
});

test("telegramStatus reports booleans, never secrets", () => {
  const st = telegramStatus();
  assert.equal(st.configured, false);
  assert.equal(st.recipients, 0);
  assert.ok(!JSON.stringify(st).includes("token"));
});
