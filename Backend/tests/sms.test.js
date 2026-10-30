const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizePhone, smsStatus, sendSms, sendSmsAlert } = require("../services/sms");
const { defaultSenders } = require("../services/delivery");

// Env save/restore helper: these tests flip the httpSMS config.
const withEnv = async (overrides, fn) => {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
};

const CONFIGURED = { HTTPSMS_API_KEY: "test-key", HTTPSMS_FROM: "+15551234567" };
const UNCONFIGURED = { HTTPSMS_API_KEY: undefined, HTTPSMS_FROM: undefined };

const mockFetch = (handler) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  fn.calls = calls;
  return fn;
};

test("normalizePhone: strips formatting, rejects junk", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("(987) 654-3210"), "9876543210");
  assert.equal(normalizePhone("123"), "");
  assert.equal(normalizePhone("not-a-phone"), "");
  assert.equal(normalizePhone(undefined), "");
  assert.equal(normalizePhone("+91987654321012345"), ""); // too long
});

test("smsStatus: configured only when key AND gateway number are set", async () => {
  await withEnv(UNCONFIGURED, () => {
    assert.deepEqual(smsStatus(), { configured: false });
  });
  await withEnv({ ...CONFIGURED, HTTPSMS_FROM: undefined }, () => {
    assert.deepEqual(smsStatus(), { configured: false });
  });
  await withEnv(CONFIGURED, () => {
    assert.deepEqual(smsStatus(), { configured: true });
  });
});

test("sendSms: unconfigured → channel-not-configured, no HTTP call", async () => {
  await withEnv(UNCONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendSms({ to: "+919876543210", content: "SOS", fetchImpl });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendSms: invalid phone / empty content fail before any HTTP call", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    assert.deepEqual(
      (await sendSms({ to: "abc", content: "SOS", fetchImpl })).reason,
      "invalid-phone"
    );
    assert.deepEqual(
      (await sendSms({ to: "+919876543210", content: "", fetchImpl })).reason,
      "empty-content"
    );
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendSms: posts from/to/content to httpSMS with the x-api-key header", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendSms({ to: "+91 98765 43210", content: "SOS text", fetchImpl });
    assert.deepEqual(res, { sent: 1, failed: 0 });
    assert.equal(fetchImpl.calls.length, 1);
    const call = fetchImpl.calls[0];
    assert.equal(call.url, "https://api.httpsms.com/v1/messages/send");
    assert.equal(call.opts.method, "POST");
    assert.equal(call.opts.headers["x-api-key"], "test-key");
    assert.deepEqual(JSON.parse(call.opts.body), {
      from: "+15551234567",
      to: "+919876543210",
      content: "SOS text",
    });
  });
});

test("sendSms: non-2xx → sms-rejected, throw → sms-transport-error", async () => {
  await withEnv(CONFIGURED, async () => {
    const rejected = mockFetch(async () => ({ ok: false, status: 401 }));
    assert.deepEqual(
      await sendSms({ to: "+919876543210", content: "SOS", fetchImpl: rejected }),
      { sent: 0, failed: 1, reason: "sms-rejected" }
    );
    const throwing = mockFetch(async () => {
      throw new Error("network down");
    });
    assert.deepEqual(
      await sendSms({ to: "+919876543210", content: "SOS", fetchImpl: throwing }),
      { sent: 0, failed: 1, reason: "sms-transport-error" }
    );
  });
});

test("sendSmsAlert: no valid contacts → no-sms-recipients, no HTTP call", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendSmsAlert({
      message: "SOS",
      contacts: [{ name: "A", phone: "junk" }, { name: "B" }],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "no-sms-recipients" });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendSmsAlert: dedupes phones, skips invalid ones, counts per contact", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendSmsAlert({
      message: "SOS",
      contacts: [
        { phone: "+919876543210" },
        { phone: "+919876543210" }, // duplicate — one send only
        { phone: "junk" },
        { phone: "+442071234567" },
      ],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 2, failed: 0 });
    assert.equal(fetchImpl.calls.length, 2);
    assert.deepEqual(
      fetchImpl.calls.map((c) => JSON.parse(c.opts.body).to),
      ["+919876543210", "+442071234567"]
    );
  });
});

test("sendSmsAlert: partial failure counts both, all-fail surfaces the reason", async () => {
  await withEnv(CONFIGURED, async () => {
    const mixed = mockFetch(async (url, opts) => ({
      ok: JSON.parse(opts.body).to === "+919876543210",
      status: 200,
    }));
    const partial = await sendSmsAlert({
      message: "SOS",
      contacts: [{ phone: "+919876543210" }, { phone: "+442071234567" }],
      fetchImpl: mixed,
    });
    assert.equal(partial.sent, 1);
    assert.equal(partial.failed, 1);
    assert.equal(partial.reason, undefined);

    const allDown = mockFetch(async () => ({ ok: false, status: 500 }));
    const failed = await sendSmsAlert({
      message: "SOS",
      contacts: [{ phone: "+919876543210" }],
      fetchImpl: allDown,
    });
    assert.deepEqual(failed, { sent: 0, failed: 1, reason: "sms-rejected" });
  });
});

test("delivery wiring: default SMS sender reports not-configured without env", async () => {
  await withEnv(UNCONFIGURED, async () => {
    const res = await defaultSenders.sms({
      message: "SOS",
      contacts: [{ phone: "+919876543210" }],
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
  });
});
