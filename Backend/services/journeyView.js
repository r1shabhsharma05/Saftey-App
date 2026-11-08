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
const crypto = require("crypto");

const journeyToken = (journeyId) => {
  const secret = process.env.API_SECRET || "";
  if (!secret || typeof journeyId !== "string" || !journeyId) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`journey-view:${journeyId}`)
    .digest("hex");
};

const verifyJourneyToken = (journeyId, token) => {
  const expected = journeyToken(journeyId);
  if (!expected || typeof token !== "string") return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { journeyToken, verifyJourneyToken };
