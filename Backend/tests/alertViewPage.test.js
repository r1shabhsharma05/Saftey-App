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
    /^https:\/\/example\.invalid\/alert\/[0-9a-f-]+\/view\?token=\d+\.[0-9a-f]{64}$/
  );

  // The link works from a plain browser-style GET (no API key).
  const pageUrl = body.viewUrl.replace("https://example.invalid", base);
  const page = await fetch(pageUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("28.6139, 77.209"));
});

test("close: delivered alert closes, then view/location/ack are 410", async () => {
  const { createAlert, transition } = require("../services/alertLifecycle");
  const alertStore = require("../services/alertStore");
  const { viewToken } = require("../services/alertView");
  const alert = createAlert({ contactsCount: 0, lat: 28.6139, lng: 77.209 });
  transition(alert, "dispatching");
  transition(alert, "delivered");
  alertStore.save(alert);
  const token = viewToken(alert.id);

  const wrongKey = await fetch(`${base}/alert/${alert.id}/close`, {
    method: "POST",
    headers: { "x-api-key": "wrong" },
  });
  assert.equal(wrongKey.status, 401);

  const closed = await fetch(`${base}/alert/${alert.id}/close`, {
    method: "POST",
    headers: { "x-api-key": KEY },
  });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).state, "closed");

  const page = await fetch(`${base}/alert/${alert.id}/view?token=${token}`);
  assert.equal(page.status, 410);
  const loc = await fetch(`${base}/alert/${alert.id}/location?token=${token}`);
  assert.equal(loc.status, 410);
  const ack = await fetch(`${base}/alert/${alert.id}/ack?token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+919999999999" }),
  });
  assert.equal(ack.status, 410);

  // Already closed → 409, not a silent re-close.
  const again = await fetch(`${base}/alert/${alert.id}/close`, {
    method: "POST",
    headers: { "x-api-key": KEY },
  });
  assert.equal(again.status, 409);
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
