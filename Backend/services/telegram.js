// 📨 Telegram channel service.
//
// Owns the bot token / chat-ID config and the single shared send function.
// Returns { sent, failed } per chat so callers can answer honestly.
// Previously delivery failures were only logged and every caller reported
// success — which made /test-alert useless as a config check (it exists
// precisely to answer "is my Telegram wiring working?").
const axios = require("axios");

// 🔐 Telegram config — secrets come from the environment, never from code.
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS in the hosting dashboard
// (Vercel → Project → Settings → Environment Variables).
// NOTE: a bot token was previously hardcoded in this public repo's history —
// rotate it via BotFather; the code no longer embeds any credential.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// 👇 Recipient chat IDs — comma-separated, from the environment.
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 🔥 COMMON SEND FUNCTION
const sendTelegramMessage = async (message) => {
  const result = { sent: 0, failed: 0 };
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.log("⚠️ Telegram disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_IDS.");
    result.failed = 1;
    return result;
  }
  // Parallel, not serial: awaiting chats one by one stacked an 8s
  // timeout per recipient inside the SOS request, and with Vercel's
  // default function cap the platform could kill /alert mid-flight —
  // the phone then saw a dropped connection instead of an answer.
  await Promise.all(
    CHAT_IDS.map(async (chat_id) => {
      try {
        const resp = await axios.post(
          `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
          {
            chat_id,
            text: message,
          },
          // Axios's default timeout is 0 (never). /alert awaits delivery,
          // so a stalled Telegram API would hang the SOS request until
          // the platform kills the function — fail fast and honestly.
          { timeout: 6000 }
        );
        if (resp.data && resp.data.ok) {
          console.log(`✅ Message successfully sent to Telegram ID: ${chat_id}`);
          result.sent += 1;
        } else {
          console.log(`❌ Telegram rejected message for ${chat_id}:`, resp.data && resp.data.description);
          result.failed += 1;
        }
      } catch (err) {
        console.log(`❌ Failed for ${chat_id}:`, err.response?.data?.description || err.message);
        result.failed += 1;
      }
    })
  );
  return result;
};

// Config-status for /health — booleans only, never secret values.
const telegramStatus = () => ({
  configured: Boolean(BOT_TOKEN && CHAT_IDS.length > 0),
  recipients: CHAT_IDS.length,
});

module.exports = { sendTelegramMessage, telegramStatus };
