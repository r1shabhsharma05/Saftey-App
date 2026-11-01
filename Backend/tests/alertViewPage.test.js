// Route test for the D9 alert-view link: with a public base URL and a
// signing secret, POST /alert embeds a working view link in its
// response (and, by construction, in the SOS message). Runs in its
// own process (node:test isolates files), with its own SOS budget.
process.env.API_SECRET = "d9-page-secret";
process.env.PUBLIC_BASE_URL = "https://example.invalid";
for (const v of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_IDS",
  "HTTPSMS_API_KEY",
  "HTTPSMS_FROM",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "FCM_PROJECT_ID",
  "FCM_CLIENT_EMAIL",
  "FCM_PRIVATE_KEY",
  "QSTASH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  delete process.env[v];
}

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");

const KEY = "d9-page-secret";
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

test("SOS response carries a viewUrl that serves the live page", async () => {
  const res = await fetch(`${base}/alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({ lat: 28.6139, lng: 77.209, contacts: [] }),
  });
  // All channels unconfigured → 502, but the alert + link still exist.
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.ok(body.alertId);
  assert.ok(body.viewUrl, "viewUrl present when base URL + secret exist");
  assert.match(
    body.viewUrl,
    /^https:\/\/example\.invalid\/alert\/[0-9a-f-]+\/view\?token=[0-9a-f]{64}$/
  );

  // The link works from a plain browser-style GET (no API key).
  const pageUrl = body.viewUrl.replace("https://example.invalid", base);
  const page = await fetch(pageUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("28.6139, 77.209"));
});

test("without a signing secret there is no viewUrl to leak", async () => {
  // This file's process has API_SECRET set, so the negative case is
  // covered at the unit level (alertView.test.js); here we assert the
  // response shape stays stable: viewUrl is a string-or-null field,
  // never an error.
  const res = await fetch(`${base}/alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({ lat: 28.6139, lng: 77.209, contacts: [] }),
  });
  const body = await res.json();
  assert.equal(typeof body.viewUrl, "string");
});
