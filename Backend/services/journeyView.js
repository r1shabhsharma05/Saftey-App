// 🔗 Journey-view tokens — SafeLife 2.0 Day 16 (plan §6 D16).
//
// The contacts-side journey page (GET /journey/:id/view) must be
// openable by a contact who has no app and no API key, without making
// the traveller's live location public to anyone who guesses a
// journey id. Same pattern as services/alertView.js (D9): HMAC-SHA256
// over a domain-separated string, keyed by the existing API_SECRET,
// verified with a timing-safe compare. No new secret, no database
// row, no login for the contact. The domain string differs
// ("journey-view:" vs "alert-view:") so a token minted for an alert
// can never open a journey, and vice versa.
//
// Threat model, stated plainly: whoever holds the link can view this
// ONE journey's live location until it ends (the view route answers
// 410 for arrived/cancelled journeys). Forwarding the link forwards
// access — that is the point of a share link, and it is why the link
// is shared by the traveller, never published. Without API_SECRET
// there is no signing key, so no token can be minted or verified —
// the page then answers 401 for every request instead of serving
// location unauthenticated.
//
// Run-2 2.5: journey-view links lapse 24 h after minting, in the
// same expiry.HMAC format as the alert-view token — a journey that
// is never closed must not stay viewable indefinitely.
const crypto = require("crypto");

const JOURNEY_VIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const journeyToken = (journeyId, expiresAtMs = Date.now() + JOURNEY_VIEW_TOKEN_TTL_MS) => {
  const secret = process.env.API_SECRET || "";
  if (!secret || typeof journeyId !== "string" || !journeyId || !Number.isFinite(expiresAtMs)) return null;
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`journey-view:${journeyId}:${expiresAtMs}`)
    .digest("hex");
  return `${expiresAtMs}.${mac}`;
};

const verifyJourneyToken = (journeyId, token) => {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = journeyToken(journeyId, expiresAtMs);
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { journeyToken, verifyJourneyToken, JOURNEY_VIEW_TOKEN_TTL_MS };
