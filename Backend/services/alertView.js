// 🔗 Alert-view tokens — SafeLife 2.0 Day 9 (plan §6 D9).
//
// The contacts-side alert page (GET /alert/:id/view) must be openable
// by a contact who has no app and no API key, without making the
// victim's live location public to anyone who guesses an alert id.
// The token is a per-alert capability, the same pattern as D4's
// retry HMAC: HMAC-SHA256 over a domain-separated string, keyed by
// the existing API_SECRET, verified with a timing-safe compare. No
// new secret, no database row, no login for the contact.
//
// Threat model, stated plainly: whoever holds the link can view this
// ONE alert's live location until the alert is closed (the view route
// answers 410 for closed alerts) or the token expires (24 h —
// POST /alert/:id/close ends it sooner). Forwarding the link forwards
// access — that is the point of a share link, and it is why the link
// is sent only inside the SOS messages to the victim's chosen
// contacts, never published. Without API_SECRET there is no signing
// key, so no token can be minted or verified — the page then answers
// 401 for every request instead of serving location unauthenticated.
const crypto = require("crypto");

// View links lapse a day after minting: a forwarded link must not
// track the victim's live location forever. The expiry rides inside
// the token (expiry.HMAC) so no server state is needed to enforce it.
const VIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const viewToken = (alertId, expiresAtMs = Date.now() + VIEW_TOKEN_TTL_MS) => {
  const secret = process.env.API_SECRET || "";
  if (!secret || typeof alertId !== "string" || !alertId || !Number.isFinite(expiresAtMs)) return null;
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`alert-view:${alertId}:${expiresAtMs}`)
    .digest("hex");
  return `${expiresAtMs}.${mac}`;
};

const verifyViewToken = (alertId, token) => {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = viewToken(alertId, expiresAtMs);
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { viewToken, verifyViewToken, VIEW_TOKEN_TTL_MS };
