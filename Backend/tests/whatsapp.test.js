const test = require("node:test");
const assert = require("node:assert/strict");

const {
  whatsappStatus,
  whatsappRecipient,
  sendWhatsApp,
  sendWhatsAppAlert,
} = require("../services/whatsapp");
const { normalizePhone } = require("../services/sms");
const { defaultSenders } = require("../services/delivery");

// Env save/restore helper: these tests flip the WhatsApp config.
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

const CONFIGURED = {
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_PHONE_NUMBER_ID: "123456789",
  WHATSAPP_TEMPLATE_NAME: "safelife_sos_alert",
};
const UNCONFIGURED = {
  WHATSAPP_ACCESS_TOKEN: undefined,
  WHATSAPP_PHONE_NUMBER_ID: undefined,
  WHATSAPP_TEMPLATE_NAME: undefined,
  WHATSAPP_TEMPLATE_LANGUAGE: undefined,
};

const mockFetch = (handler) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts);
  };
  fn.calls = calls;
  return fn;
};

test("whatsappRecipient: shared phone rules, leading + stripped for Meta", () => {
  assert.equal(whatsappRecipient("+91 98765 43210"), "919876543210");
  assert.equal(whatsappRecipient("(987) 654-3210"), "9876543210");
  assert.equal(whatsappRecipient("not-a-phone"), "");
  assert.equal(whatsappRecipient(undefined), "");
  // Same allowlist as SMS: the two per-contact channels never disagree
  // on what counts as a phone number.
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
});

test("whatsappStatus: configured only when token, phone-number id AND template name are set", async () => {
  await withEnv(UNCONFIGURED, () => {
    assert.deepEqual(whatsappStatus(), { configured: false });
  });
  await withEnv({ ...CONFIGURED, WHATSAPP_TEMPLATE_NAME: undefined }, () => {
    assert.deepEqual(whatsappStatus(), { configured: false });
  });
  await withEnv({ ...CONFIGURED, WHATSAPP_PHONE_NUMBER_ID: undefined }, () => {
    assert.deepEqual(whatsappStatus(), { configured: false });
  });
  await withEnv(CONFIGURED, () => {
    assert.deepEqual(whatsappStatus(), { configured: true });
  });
});

test("sendWhatsApp: unconfigured → channel-not-configured, no HTTP call", async () => {
  await withEnv(UNCONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendWhatsApp({ to: "+919876543210", fetchImpl });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendWhatsApp: invalid phone fails before any HTTP call", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    assert.deepEqual(
      (await sendWhatsApp({ to: "abc", fetchImpl })).reason,
      "invalid-phone"
    );
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendWhatsApp: posts a parameterless template to the Graph API with the Bearer token", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendWhatsApp({ to: "+91 98765 43210", fetchImpl });
    assert.deepEqual(res, { sent: 1, failed: 0 });
    assert.equal(fetchImpl.calls.length, 1);
    const call = fetchImpl.calls[0];
    assert.equal(call.url, "https://graph.facebook.com/v23.0/123456789/messages");
    assert.equal(call.opts.method, "POST");
    assert.equal(call.opts.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(call.opts.body), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919876543210",
      type: "template",
      template: {
        name: "safelife_sos_alert",
        language: { code: "en_US", policy: "deterministic" },
      },
    });
  });
});

test("sendWhatsApp: language override is honoured", async () => {
  await withEnv({ ...CONFIGURED, WHATSAPP_TEMPLATE_LANGUAGE: "hi" }, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    await sendWhatsApp({ to: "+919876543210", fetchImpl });
    assert.equal(
      JSON.parse(fetchImpl.calls[0].opts.body).template.language.code,
      "hi"
    );
  });
});

test("sendWhatsApp: non-2xx → whatsapp-rejected, throw → whatsapp-transport-error", async () => {
  await withEnv(CONFIGURED, async () => {
    const rejected = mockFetch(async () => ({ ok: false, status: 400 }));
    assert.deepEqual(
      await sendWhatsApp({ to: "+919876543210", fetchImpl: rejected }),
      { sent: 0, failed: 1, reason: "whatsapp-rejected" }
    );
    const throwing = mockFetch(async () => {
      throw new Error("network down");
    });
    assert.deepEqual(
      await sendWhatsApp({ to: "+919876543210", fetchImpl: throwing }),
      { sent: 0, failed: 1, reason: "whatsapp-transport-error" }
    );
  });
});

test("sendWhatsAppAlert: no valid contacts → no-whatsapp-recipients, no HTTP call", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendWhatsAppAlert({
      contacts: [{ name: "A", phone: "junk" }, { name: "B" }],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "no-whatsapp-recipients" });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

test("sendWhatsAppAlert: dedupes phones, skips invalid ones, counts per contact", async () => {
  await withEnv(CONFIGURED, async () => {
    const fetchImpl = mockFetch(async () => ({ ok: true, status: 200 }));
    const res = await sendWhatsAppAlert({
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
      ["919876543210", "442071234567"]
    );
  });
});

test("sendWhatsAppAlert: partial failure counts both, all-fail surfaces the reason", async () => {
  await withEnv(CONFIGURED, async () => {
    const mixed = mockFetch(async (url, opts) => ({
      ok: JSON.parse(opts.body).to === "919876543210",
      status: 200,
    }));
    const partial = await sendWhatsAppAlert({
      contacts: [{ phone: "+919876543210" }, { phone: "+442071234567" }],
      fetchImpl: mixed,
    });
    assert.equal(partial.sent, 1);
    assert.equal(partial.failed, 1);
    assert.equal(partial.reason, undefined);

    const allDown = mockFetch(async () => ({ ok: false, status: 500 }));
    const failed = await sendWhatsAppAlert({
      contacts: [{ phone: "+919876543210" }],
      fetchImpl: allDown,
    });
    assert.deepEqual(failed, { sent: 0, failed: 1, reason: "whatsapp-rejected" });
  });
});

test("delivery wiring: default WhatsApp sender reports not-configured without env", async () => {
  await withEnv(UNCONFIGURED, async () => {
    const res = await defaultSenders.whatsapp({
      contacts: [{ phone: "+919876543210" }],
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
  });
});
