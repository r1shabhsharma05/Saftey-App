// ⏱️ QStash — serverless delayed-job wiring (D2).
//
// Why QStash: Vercel serverless has no long-running worker, so delivery
// retries and the escalation ladder (D4/D10) cannot live in-process.
// QStash delivers them as delayed HTTPS callbacks to our own API.
// Amendment A2 scope for D2 is the wiring + primitive only — no
// consumer route lands here; D4/D10 add the callback endpoints.
//
// Honest return shape, never a throw for the expected cases: without
// config the job is NOT queued ({ queued: false, reason:
// "not-configured" }) — a caller that ignores that shape would silently
// drop an escalation, so D4/D10 must treat queued:false as a failure
// to surface, not as success. Transport errors report the same way.
//
// SECURITY: url must be one of OUR OWN endpoints. publishDelayed makes
// Upstash POST to that URL — never pass user input as url, or an
// attacker could aim delayed POSTs at arbitrary hosts (SSRF-by-proxy).
const axios = require("axios");

const getConfig = () => ({ token: process.env.QSTASH_TOKEN || "" });

const qstashStatus = () => ({ configured: Boolean(getConfig().token) });

// Production transport: POST https://qstash.upstash.io/v2/publish/<url>
// with the delay as a duration header (e.g. "60s").
let transport = async ({ url, body, delaySeconds, deduplicationId }) => {
  const headers = {
    Authorization: `Bearer ${getConfig().token}`,
    "Upstash-Delay": `${delaySeconds}s`,
    "Content-Type": "application/json",
  };
  if (deduplicationId) headers["Upstash-Deduplication-Id"] = deduplicationId;
  const resp = await axios.post(`https://qstash.upstash.io/v2/publish/${url}`, body, {
    headers,
    timeout: 10000,
  });
  return resp.data;
};

const publishDelayed = async ({ url, body, delaySeconds, deduplicationId } = {}) => {
  if (!qstashStatus().configured) return { queued: false, reason: "not-configured" };
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new TypeError("publishDelayed: url must be an http(s) URL");
  }
  if (!Number.isInteger(delaySeconds) || delaySeconds <= 0) {
    throw new TypeError("publishDelayed: delaySeconds must be a positive integer");
  }
  try {
    const data = await transport({ url, body, delaySeconds, deduplicationId });
    return { queued: true, messageId: data && data.messageId };
  } catch (err) {
    console.log("❌ QStash publish failed:", err.message);
    return { queued: false, reason: "transport-error" };
  }
};

module.exports = {
  qstashStatus,
  publishDelayed,
  // Test seam only — lets tests drive publishing without network.
  _setQstashTransport: (fn) => {
    transport = fn;
  },
};
