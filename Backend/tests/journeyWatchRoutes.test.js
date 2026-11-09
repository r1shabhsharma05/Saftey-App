// 🧭 Journey watch route tests — SafeLife 2.0 Day 17 (plan §6 D17).
// Deviation + overstay detection → check-in prompt → auto-escalation,
// over real HTTP with every external dependency unconfigured (no
// QStash, no public URL, no channels): every schedule attempt reports
// queued:false honestly and every fan-out reports sent 0. This file
// is separate from journeyRoutes.test.js because the two files
// together exceed the tracking limiter's 60/min budget in one
// process — each file gets its own server and its own bucket.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_SECRET = "d17-route-secret";
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
  "BOLNA_API_KEY",
  "BOLNA_AGENT_ID",
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
const journeyStore = require("../services/journeyStore");
const { journeyToken } = require("../services/journeyView");
const { journeyEscalationToken } = require("../services/journeyEscalation");

const KEY = "d17-route-secret";
const UNKNOWN = "00000000-0000-0000-0000-000000000000";
const HEADERS = { "Content-Type": "application/json", "x-api-key": KEY };
const NOKEY = { "Content-Type": "application/json" };

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
beforeEach(() => journeyStore._clearMemory());

const post = (path, body, headers = HEADERS) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (path, headers = HEADERS) => fetch(`${base}${path}`, { headers });

const createBody = () => ({
  originLat: 28.6139,
  originLng: 77.209,
  destLat: 28.62,
  destLng: 77.215,
  destinationLabel: "Connaught Place",
  expectedArrivalAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
  userName: "Rishabh Sharma",
});

const createJourneyWithContacts = async () => {
  const res = await post("/journeys", {
    ...createBody(),
    contacts: [{ phone: "+919876543210" }, { phone: "+919812345678", pushToken: "ExponentPushToken[abc]" }],
  });
  assert.equal(res.status, 200);
  return res.json();
};

// The origin→destination line runs diagonally NE, so a pure-east
// nudge is only ~75% off the line: +0.009° lng (~880 m east) reads
// ~660 m perpendicular — past the 500 m threshold — while +0.006°
// (~590 m east) reads ~440 m and does NOT trip it.
const midOffLine = (nudgeLng = 0.009) => ({
  lat: (28.6139 + 28.62) / 2,
  lng: (77.209 + 77.215) / 2 + nudgeLng,
});

// ── Day 17: deviation + overstay detection → check-in → auto-escalation ──
// QStash, PUBLIC_BASE_URL and every channel are unconfigured in this
// file, so every schedule attempt honestly reports queued:false and
// every fan-out reports sent 0 — the detection + prompt half is what
// these tests prove end to end, over real HTTP.
test("D17 POST /journeys: contacts stored, overdue-escalate job scheduled (honestly unqueued)", async () => {
  const data = await createJourneyWithContacts();
  assert.equal(data.success, true);
  assert.equal(data.journey.watch.status, "ok");
  assert.equal(data.journey.checkIn, null);
  assert.equal(data.scheduled.length, 1);
  assert.equal(data.scheduled[0].kind, "overdue-escalate");
  assert.equal(data.scheduled[0].queued, false);
  assert.equal(data.scheduled[0].reason, "no-public-url", "no base URL is checked before QStash is even attempted");
  // With a base URL but still no QStash token, the honest reason is the other half.
  process.env.PUBLIC_BASE_URL = "https://example.invalid";
  try {
    const again = await createJourneyWithContacts();
    assert.equal(again.scheduled[0].reason, "not-configured");
  } finally {
    delete process.env.PUBLIC_BASE_URL;
  }
  const stored = await journeyStore.get(data.journey.id);
  assert.equal(stored.contacts.length, 2);
  assert.equal(stored.contacts[0].phone, "+919876543210");
  assert.equal(stored.escalation.scheduled.length, 1);
});

test("D17 POST /location: a >500 m deviation asks a check-in once, and only once", async () => {
  const { journey } = await createJourneyWithContacts();
  const mid = midOffLine();
  const res = await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.journey.watch.status, "deviated");
  assert.ok(data.journey.watch.deviationM > 500);
  assert.equal(data.journey.checkIn.reason, "deviated");
  assert.ok(Date.parse(data.journey.checkIn.dueAt) > Date.parse(data.journey.checkIn.askedAt));
  const stored = await journeyStore.get(journey.id);
  assert.equal(stored.escalation.scheduled.length, 2, "create job + check-in job");
  assert.equal(stored.escalation.scheduled[1].kind, "checkin-escalate");

  // Still deviated on the next post: no second prompt, no second job.
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng + 0.001 });
  const again = await journeyStore.get(journey.id);
  assert.equal(again.escalation.scheduled.length, 2);
  assert.equal(again.checkIn.reason, "deviated");
});

test("D17 POST /checkin: ok=true clears the prompt and records the answer; a second answer is 409", async () => {
  const { journey } = await createJourneyWithContacts();
  assert.equal((await post(`/journey/${journey.id}/checkin`, { ok: true })).status, 409, "no prompt pending yet");
  assert.equal((await post(`/journey/${journey.id}/checkin`, { ok: "yes" })).status, 400);

  const mid = midOffLine();
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng });
  const res = await post(`/journey/${journey.id}/checkin`, { ok: true });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.journey.checkIn, null);
  const stored = await journeyStore.get(journey.id);
  assert.ok(stored.lastOkAt);
  assert.equal(stored.lastOkReason, "deviated");
  assert.equal((await post(`/journey/${journey.id}/checkin`, { ok: true })).status, 409);

  // Still deviated, but inside the 10 min OK cooldown: no re-prompt.
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng + 0.001 });
  assert.equal((await journeyStore.get(journey.id)).checkIn, null);
});

test("D17 POST /checkin: ok=false escalates to contacts immediately (sent 0, channels down)", async () => {
  const { journey } = await createJourneyWithContacts();
  const mid = midOffLine();
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng });
  const res = await post(`/journey/${journey.id}/checkin`, { ok: false });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.escalation.sent, 0);
  assert.equal(data.escalation.failed, 4);
  const stored = await journeyStore.get(journey.id);
  assert.equal(stored.escalation.runs.length, 1);
  assert.equal(stored.escalation.runs[0].kind, "checkin-answer");
  assert.equal(stored.escalation.runs[0].reason, "deviated");
});

test("D17 POST /journey-escalate: overdue + unanswered escalates once; repeats and arrivals are ignored", async () => {
  const { journey } = await createJourneyWithContacts();
  const token = journeyEscalationToken(journey.id, "overdue-escalate");
  const body = { journeyId: journey.id, kind: "overdue-escalate", token };
  // Forged token / bad kind / unknown id are refused before any send.
  assert.equal((await post("/journey-escalate", { ...body, token: "0".repeat(64) }, NOKEY)).status, 401);
  assert.equal((await post("/journey-escalate", { ...body, kind: "nope" }, NOKEY)).status, 400);
  assert.equal(
    (await post("/journey-escalate", { ...body, journeyId: UNKNOWN, token: journeyEscalationToken(UNKNOWN, "overdue-escalate") }, NOKEY)).status,
    404
  );
  // Not overdue yet: the timer firing early stands down.
  const early = await post("/journey-escalate", body, NOKEY);
  assert.equal((await early.json()).ignored, true);

  // Rewind the ETA: now overdue, still active, never answered.
  const stored = await journeyStore.get(journey.id);
  stored.expectedArrivalAt = new Date(Date.now() - 60 * 1000).toISOString();
  journeyStore.save(stored);
  const res = await post("/journey-escalate", body, NOKEY);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ignored, undefined);
  assert.equal(data.sent, 0);
  assert.equal(data.failed, 4);
  // A QStash redelivery of the same job must not re-spam contacts.
  assert.equal((await (await post("/journey-escalate", body, NOKEY)).json()).ignored, true);

  // Arrived after the timer: the job stands down.
  const j2 = (await createJourneyWithContacts()).journey;
  await post(`/journey/${j2.id}/arrived`, {});
  const arrivedBody = { journeyId: j2.id, kind: "overdue-escalate", token: journeyEscalationToken(j2.id, "overdue-escalate") };
  assert.equal((await (await post("/journey-escalate", arrivedBody, NOKEY)).json()).ignored, true);
});

test("D17 POST /journey-escalate: check-in job fires only for the live prompt", async () => {
  const { journey } = await createJourneyWithContacts();
  const mid = midOffLine();
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng });
  const stored = await journeyStore.get(journey.id);
  const askedAt = stored.checkIn.askedAt;
  const token = journeyEscalationToken(journey.id, "checkin-escalate");
  const body = { journeyId: journey.id, kind: "checkin-escalate", token, askedAt };
  const res = await post("/journey-escalate", body, NOKEY);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).sent, 0);
  // Same job again: ignored (already ran). A stale askedAt: ignored too.
  assert.equal((await (await post("/journey-escalate", body, NOKEY)).json()).ignored, true);
  assert.equal(
    (await (await post("/journey-escalate", { ...body, askedAt: new Date(Date.now() - 60000).toISOString() }, NOKEY)).json()).ignored,
    true
  );
});

test("D17 GET /journey/:id and view page carry the watch state and the pending check-in", async () => {
  const { journey } = await createJourneyWithContacts();
  const mid = midOffLine();
  await post(`/journey/${journey.id}/location`, { lat: mid.lat, lng: mid.lng });
  const data = await (await get(`/journey/${journey.id}`)).json();
  assert.equal(data.journey.watch.status, "deviated");
  assert.equal(data.journey.checkIn.reason, "deviated");
  const html = await (await get(`/journey/${journey.id}/view?token=${journeyToken(journey.id)}`, {})).text();
  assert.match(html, /check-in/i);
  assert.match(html, /deviated/i);
});
