// 🔔 Push channel service — SafeLife 2.0 Day 9 (plan §6 D9).
//
// Firebase Cloud Messaging HTTP v1 API: this server POSTs to
// https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
// with a short-lived OAuth 2.0 access token minted from a service
// account (RS256 JWT assertion → https://oauth2.googleapis.com/token,
// scope https://www.googleapis.com/auth/firebase.messaging — the
// shape verified against Firebase's HTTP v1 docs before writing).
// The legacy FCM API (server key, /fcm/send) was shut down in 2024
// and is deliberately NOT used: a server-key send would fail every
// time and look like a channel outage.
//
// No new dependency: the JWT is signed with node:crypto and both
// HTTP calls use the global fetch (the same 6s fail-fast timeout
// the SMS/WhatsApp adapters use, so a stalled Google API cannot
// hang the SOS request until Vercel kills it). One access token is
// minted per fan-out and reused for every token in that fan-out —
// minting per device would multiply Google calls for no reason, and
// no token is cached across calls: a frozen serverless instance
// cannot be trusted to hold a fresh one.
//
// Config (server-side only, never in the app): FCM_PROJECT_ID,
// FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (the service account's PEM key;
// Vercel env vars carry it with literal \n escapes, normalized
// here). Without all three, every send honestly reports
// channel-not-configured — the same reason string D4's stub used,
// so the D6 simulation suite keeps meaning what it meant.
//
// Recipients are FCM registration tokens, NOT phone numbers: a
// contact's pushToken (optional, per contact) is what this channel
// addresses. No token registry exists yet — the app does not collect
// tokens (no expo-notifications; that install + Firebase project +
// google-services.json is a named follow-up, not snuck in here) —
// so until the app sends pushTokens, this channel honestly reports
// no-push-recipients. A 2xx from FCM means ACCEPTED, not delivered
// to the handset; tokens are never logged.
const crypto = require("crypto");

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const pushConfig = () => ({
  projectId: (process.env.FCM_PROJECT_ID || "").trim(),
  clientEmail: (process.env.FCM_CLIENT_EMAIL || "").trim(),
  // Vercel stores the PEM with literal backslash-n; a real PEM passes
  // through unchanged.
  privateKey: (process.env.FCM_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
});

// Config-status for /health — booleans only, never secret values.
const pushStatus = () => {
  const { projectId, clientEmail, privateKey } = pushConfig();
  return { configured: Boolean(projectId && clientEmail && privateKey) };
};

// FCM registration tokens are opaque strings (letters, digits, : _ -
// and friends); the only safe validation is "non-empty, bounded, no
// whitespace or control characters" — anything stricter would reject
// a token format Google has not documented as fixed.
const isValidPushToken = (token) =>
  typeof token === "string" &&
  token.length > 0 &&
  token.length <= 1024 &&
  !/[\s\x00-\x1F\x7F]/.test(token);

const base64url = (value) =>
  Buffer.from(value).toString("base64url");

// Mint one OAuth 2.0 access token from the service account: sign a
// JWT assertion (RS256, 1h expiry) and exchange it. Returns the token
// string, or null when minting fails — the caller reports
// push-auth-failed and sends nothing, never a half-authenticated send.
const mintAccessToken = async ({ fetchImpl = fetch } = {}) => {
  const { clientEmail, privateKey } = pushConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${payload}`;
  let signature;
  try {
    signature = crypto
      .sign("RSA-SHA256", Buffer.from(signingInput), privateKey)
      .toString("base64url");
  } catch {
    // Unparseable private key (bad env value) — an auth failure, not a throw.
    return null;
  }
  try {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${signingInput}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.access_token === "string" && data.access_token
      ? data.access_token
      : null;
  } catch {
    return null;
  }
};

// One push to one device. Never throws: every failure mode returns a
// counted failure with a reason, so one bad token cannot kill the
// rest of the fan-out (delivery.js enforces the same contract).
const sendPush = async ({ to, title, body, accessToken, fetchImpl = fetch } = {}) => {
  const { projectId } = pushConfig();
  if (!projectId) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  if (!isValidPushToken(to)) {
    return { sent: 0, failed: 1, reason: "invalid-token" };
  }
  if (typeof body !== "string" || body.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  if (!accessToken) {
    return { sent: 0, failed: 1, reason: "push-auth-failed" };
  }
  try {
    const res = await fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        // One target per request: HTTP v1 has no token list (the
        // retired batch endpoint went with the legacy API).
        body: JSON.stringify({
          message: {
            token: to,
            notification: { title, body },
          },
        }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (res.ok) return { sent: 1, failed: 0 };
    console.log("❌ FCM rejected message: HTTP", res.status);
    return { sent: 0, failed: 1, reason: "push-rejected" };
  } catch (err) {
    console.log("❌ FCM send failed:", err.name || "transport-error");
    return { sent: 0, failed: 1, reason: "push-transport-error" };
  }
};

// Fan-out over the alert's emergency contacts: one push per distinct
// valid pushToken. Counts are per device, like SMS/WhatsApp per
// contact. The notification body is the SOS message truncated to
// 500 chars — a push is a ping; the full text + live page travel on
// SMS/Telegram and in the alert-view link inside the message.
const sendPushAlert = async ({ message, contacts = [], fetchImpl = fetch } = {}) => {
  if (!pushStatus().configured) {
    return { sent: 0, failed: 1, reason: "channel-not-configured" };
  }
  if (typeof message !== "string" || message.length === 0) {
    return { sent: 0, failed: 1, reason: "empty-content" };
  }
  const tokens = [
    ...new Set(
      (Array.isArray(contacts) ? contacts : [])
        .slice(0, 10)
        .map((c) => (typeof c?.pushToken === "string" ? c.pushToken.trim() : ""))
        .filter(isValidPushToken)
    ),
  ];
  if (tokens.length === 0) {
    return { sent: 0, failed: 1, reason: "no-push-recipients" };
  }
  const accessToken = await mintAccessToken({ fetchImpl });
  if (!accessToken) {
    return { sent: 0, failed: tokens.length, reason: "push-auth-failed" };
  }
  const results = await Promise.all(
    tokens.map((to) =>
      sendPush({
        to,
        title: "🚨 SafeLife SOS Alert",
        body: message.slice(0, 500),
        accessToken,
        fetchImpl,
      })
    )
  );
  const sent = results.reduce((n, r) => n + r.sent, 0);
  const failed = results.reduce((n, r) => n + r.failed, 0);
  const out = { sent, failed };
  if (sent === 0) {
    // All failed: surface the dominant reason so the status UI and the
    // operator can tell "Google rejected" from "bad tokens" at a glance.
    out.reason = results[0].reason || "push-failed";
  }
  return out;
};

module.exports = {
  pushConfig,
  pushStatus,
  isValidPushToken,
  mintAccessToken,
  sendPush,
  sendPushAlert,
};
