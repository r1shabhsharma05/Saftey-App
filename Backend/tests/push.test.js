// Unit tests for services/push.js — FCM HTTP v1 push channel (D9).
// The fetch boundary is mocked: one fake serves both the OAuth2
// token exchange and the FCM send, so the exact request shapes
// (JWT assertion, Bearer header, per-token message body) are pinned
// without any network. A real RSA keypair is generated in-process so
// the JWT signature is genuinely verifiable.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  pushStatus,
  isValidPushToken,
  mintAccessToken,
  sendPush,
  sendPushAlert,
} = require("../services/push");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" });

const FCM_VARS = {
  FCM_PROJECT_ID: "safelife-test",
  FCM_CLIENT_EMAIL: "test@safelife-test.iam.gserviceaccount.com",
  FCM_PRIVATE_KEY: PRIVATE_PEM,
};

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const k of Object.keys(FCM_VARS)) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(FCM_VARS)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
};

// Fake fetch: token exchange returns a fixed access token; FCM sends
// succeed unless the test overrides per-token behaviour. Every call
// is recorded with its URL + options.
const fakeFetch = (onFcm) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url === "https://oauth2.googleapis.com/token") {
      return { ok: true, json: async () => ({ access_token: "ya29.test-token" }) };
    }
    if (onFcm) return onFcm(url, opts);
    return { ok: true, status: 200 };
  };
  return { calls, fetchImpl };
};

test("pushStatus: configured only when project id + email + key are all set", async () => {
  await withEnv({}, async () => assert.equal(pushStatus().configured, false));
  await withEnv(
    { FCM_PROJECT_ID: "p" },
    async () => assert.equal(pushStatus().configured, false)
  );
  await withEnv(FCM_VARS, async () => assert.equal(pushStatus().configured, true));
});

test("unconfigured → channel-not-configured with zero HTTP calls", async () => {
  await withEnv({}, async () => {
    const { calls, fetchImpl } = fakeFetch();
    const res = await sendPushAlert({ message: "SOS", contacts: [{ pushToken: "tok1" }], fetchImpl });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "channel-not-configured" });
    assert.equal(calls.length, 0);
  });
});

test("isValidPushToken: rejects empty, whitespace, over-long and non-string tokens", () => {
  assert.equal(isValidPushToken("bk3RNwTe3H0:CI2k_HHwgIpoDKCIZvvDMExUdFQ3P1"), true);
  assert.equal(isValidPushToken(""), false);
  assert.equal(isValidPushToken("tok en"), false);
  assert.equal(isValidPushToken("tok\n"), false);
  assert.equal(isValidPushToken("x".repeat(1025)), false);
  assert.equal(isValidPushToken(42), false);
});

test("mintAccessToken: JWT assertion shape + RS256 signature verify", async () => {
  await withEnv(FCM_VARS, async () => {
    const { calls, fetchImpl } = fakeFetch();
    const token = await mintAccessToken({ fetchImpl });
    assert.equal(token, "ya29.test-token");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, "https://oauth2.googleapis.com/token");
    assert.equal(call.opts.method, "POST");
    const params = new URLSearchParams(call.opts.body);
    assert.equal(
      params.get("grant_type"),
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    );
    const assertion = params.get("assertion");
    const [h, p, sig] = assertion.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    assert.equal(header.alg, "RS256");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    assert.equal(payload.iss, FCM_VARS.FCM_CLIENT_EMAIL);
    assert.equal(payload.scope, "https://www.googleapis.com/auth/firebase.messaging");
    assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
    assert.equal(payload.exp - payload.iat, 3600);
    assert.ok(
      crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), PUBLIC_PEM, Buffer.from(sig, "base64url")),
      "assertion signature verifies against the keypair"
    );
  });
});

test("mintAccessToken: token-exchange failure → null, no throw", async () => {
  await withEnv(FCM_VARS, async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) });
    assert.equal(await mintAccessToken({ fetchImpl }), null);
    const throwing = async () => {
      throw new Error("network down");
    };
    assert.equal(await mintAccessToken({ fetchImpl: throwing }), null);
  });
});

test("mintAccessToken: unparseable private key → null", async () => {
  await withEnv(
    { ...FCM_VARS, FCM_PRIVATE_KEY: "not-a-pem-key" },
    async () => {
      const { fetchImpl } = fakeFetch();
      assert.equal(await mintAccessToken({ fetchImpl }), null);
    }
  );
});

test("sendPushAlert: exact FCM request shape, one mint reused for all tokens", async () => {
  await withEnv(FCM_VARS, async () => {
    const { calls, fetchImpl } = fakeFetch();
    const res = await sendPushAlert({
      message: "SOS at the park",
      contacts: [{ pushToken: "tok-a" }, { pushToken: "tok-b" }],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 2, failed: 0 });
    assert.equal(calls.length, 3, "1 token mint + 2 sends");
    const sends = calls.slice(1);
    for (const [i, token] of ["tok-a", "tok-b"].entries()) {
      assert.equal(
        sends[i].url,
        "https://fcm.googleapis.com/v1/projects/safelife-test/messages:send"
      );
      assert.equal(sends[i].opts.headers.Authorization, "Bearer ya29.test-token");
      assert.deepEqual(JSON.parse(sends[i].opts.body), {
        message: {
          token,
          notification: { title: "🚨 SafeLife SOS Alert", body: "SOS at the park" },
        },
      });
    }
  });
});

test("sendPushAlert: no tokens → no-push-recipients, zero HTTP calls", async () => {
  await withEnv(FCM_VARS, async () => {
    const { calls, fetchImpl } = fakeFetch();
    const res = await sendPushAlert({
      message: "SOS",
      contacts: [{ name: "No Token", phone: "+919999999999" }],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "no-push-recipients" });
    assert.equal(calls.length, 0);
  });
});

test("sendPushAlert: invalid tokens skipped, duplicates deduped, auth failure counted", async () => {
  await withEnv(FCM_VARS, async () => {
    const { calls, fetchImpl } = fakeFetch();
    const res = await sendPushAlert({
      message: "SOS",
      contacts: [
        { pushToken: "tok-a" },
        { pushToken: "tok-a" },
        { pushToken: "bad token" },
        { pushToken: "" },
      ],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 1, failed: 0 });
    assert.equal(calls.length, 2, "mint + one deduped send");
  });
  await withEnv(FCM_VARS, async () => {
    const fetchImpl = async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return { ok: false, status: 400, json: async () => ({}) };
      }
      throw new Error("FCM must not be called without a token");
    };
    const res = await sendPushAlert({
      message: "SOS",
      contacts: [{ pushToken: "tok-a" }],
      fetchImpl,
    });
    assert.deepEqual(res, { sent: 0, failed: 1, reason: "push-auth-failed" });
  });
});

test("sendPush: non-2xx → push-rejected, throw → push-transport-error", async () => {
  await withEnv(FCM_VARS, async () => {
    const rejected = await sendPush({
      to: "tok-a",
      title: "t",
      body: "b",
      accessToken: "ya29.test-token",
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.deepEqual(rejected, { sent: 0, failed: 1, reason: "push-rejected" });
    const failed = await sendPush({
      to: "tok-a",
      title: "t",
      body: "b",
      accessToken: "ya29.test-token",
      fetchImpl: async () => {
        throw new Error("boom");
      },
    });
    assert.deepEqual(failed, { sent: 0, failed: 1, reason: "push-transport-error" });
  });
});

test("sendPushAlert: partial failure counts, all-fail surfaces the reason", async () => {
  await withEnv(FCM_VARS, async () => {
    // One token accepted, one rejected: counts split, no single reason.
    const mixed = async (url, opts) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return { ok: true, json: async () => ({ access_token: "ya29.test-token" }) };
      }
      const token = JSON.parse(opts.body).message.token;
      return token === "tok-ok" ? { ok: true, status: 200 } : { ok: false, status: 500 };
    };
    const partial = await sendPushAlert({
      message: "SOS",
      contacts: [{ pushToken: "tok-ok" }, { pushToken: "tok-bad" }],
      fetchImpl: mixed,
    });
    assert.equal(partial.sent, 1);
    assert.equal(partial.failed, 1);
    assert.equal(partial.reason, undefined, "partial delivery carries no single reason");
  });
});

test("delivery wiring: default push sender is the real adapter", async () => {
  const { deliverAlert } = require("../services/delivery");
  await withEnv({}, async () => {
    const receipts = await deliverAlert({
      message: "SOS",
      contacts: [{ pushToken: "tok-a" }],
      senders: undefined,
    });
    // Unconfigured env → every channel fails honestly; push must say
    // channel-not-configured (the D4 stub's reason), proving the
    // default sender is the adapter, not a stub that says otherwise.
    const push = receipts.find((r) => r.channel === "push");
    assert.equal(push.reason, "channel-not-configured");
  });
});
