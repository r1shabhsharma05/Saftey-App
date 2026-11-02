// Voice-call channel tests — SafeLife 2.0 Day 10 (Bolna adapter).
// Request shape verified against the Bolna connector client
// (~/workspace/custom-connectors/custom.bolna/bin/client.py):
// POST https://api.bolna.ai/call, Bearer key, body
// {agent_id, recipient_phone_number, user_data?}. No live call is
// ever placed here: fetch is mocked, and no real key exists in tests.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.BOLNA_API_KEY = "test-bolna-key";
process.env.BOLNA_AGENT_ID = "test-agent-id";

const {
  voiceStatus,
  sendVoiceCall,
  sendVoiceAlert,
} = require("../services/voice");

const okFetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

test("voiceStatus: configured only with key + agent id, never leaks either", () => {
  assert.deepEqual(voiceStatus(), { configured: true });
  assert.ok(!JSON.stringify(voiceStatus()).includes("test-bolna-key"));
  delete process.env.BOLNA_AGENT_ID;
  assert.deepEqual(voiceStatus(), { configured: false });
  process.env.BOLNA_AGENT_ID = "test-agent-id";
});

test("sendVoiceCall: unconfigured → channel-not-configured, zero HTTP calls", async () => {
  delete process.env.BOLNA_API_KEY;
  let calls = 0;
  const res = await sendVoiceCall({
    to: "+919999999999",
    message: "SOS",
    fetchImpl: async () => { calls += 1; return okFetch(); },
  });
  assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
  assert.equal(calls, 0);
  process.env.BOLNA_API_KEY = "test-bolna-key";
});

test("sendVoiceCall: exact Bolna request shape", async () => {
  const seen = [];
  const res = await sendVoiceCall({
    to: "+91 99999 99999",
    name: "Asha",
    message: "SOS at 28.6,77.2",
    fetchImpl: async (url, opts) => {
      seen.push({ url, opts });
      return okFetch();
    },
  });
  assert.deepEqual(res, { sent: 1, failed: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.bolna.ai/call");
  assert.equal(seen[0].opts.method, "POST");
  assert.equal(seen[0].opts.headers.Authorization, "Bearer test-bolna-key");
  const body = JSON.parse(seen[0].opts.body);
  assert.equal(body.agent_id, "test-agent-id");
  assert.equal(body.recipient_phone_number, "+919999999999");
  assert.equal(body.user_data.recipient_name, "Asha");
  assert.equal(typeof body.user_data.sos_message, "string");
  assert.ok(body.user_data.sos_message.includes("28.6"));
});

test("sendVoiceCall: invalid phone fails before any call; non-2xx and throw counted", async () => {
  let calls = 0;
  const counting = async () => { calls += 1; return okFetch(); };
  assert.deepEqual(
    await sendVoiceCall({ to: "not-a-phone", fetchImpl: counting }),
    { sent: 0, failed: 1, reason: "invalid-phone" }
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await sendVoiceCall({ to: "+919999999999", message: "SOS", fetchImpl: async () => ({ ok: false, status: 401 }) }),
    { sent: 0, failed: 1, reason: "voice-rejected" }
  );
  assert.deepEqual(
    await sendVoiceCall({
      to: "+919999999999",
      message: "SOS",
      fetchImpl: async () => { throw new Error("down"); },
    }),
    { sent: 0, failed: 1, reason: "voice-transport-error" }
  );
});

test("sendVoiceAlert: per-contact counts, dedupe, no recipients, partial failure", async () => {
  const contacts = [
    { phone: "+919999999999", name: "Asha" },
    { phone: "+919999999999", name: "Asha dup" },
    { phone: "junk", name: "Junk" },
    { phone: "+918888888888", name: "Ravi" },
  ];
  let n = 0;
  const flaky = async () => {
    n += 1;
    return n === 1 ? okFetch() : { ok: false, status: 500 };
  };
  const res = await sendVoiceAlert({ message: "SOS", contacts, fetchImpl: flaky });
  assert.equal(res.sent, 1);
  assert.equal(res.failed, 1);
  assert.equal(n, 2, "deduped to 2 distinct valid phones");
  assert.deepEqual(
    await sendVoiceAlert({ message: "SOS", contacts: [], fetchImpl: flaky }),
    { sent: 0, failed: 1, reason: "no-voice-recipients" }
  );
  assert.deepEqual(
    await sendVoiceAlert({ message: "", contacts, fetchImpl: flaky }),
    { sent: 0, failed: 1, reason: "empty-content" }
  );
});
