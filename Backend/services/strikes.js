// 🛡️ Abuse strikes — SafeLife 2.0 Day 23 (plan §6 D23).
//
// A strike is one confirmed abuse event from one actor (an IP — the
// SOS payload carries no stable user identity, so req.ip is the only
// per-device key, the same key the rate limiters use). 3 strikes in
// 24 h blocks that IP's SOS for 1 h; each further strike while
// blocked extends the block 1 h from that strike. A blocked SOS is
// refused loudly (403 + audit line), never silently dropped.
//
// Never throws on bad input: a strike failure must never break the
// SOS or close path it observes.
//
// shortcut: per-instance memory only — same caveat as the limiters'
// memory store. A flood spread across Vercel cold starts partially
// dodges strikes. Cross-instance needs Upstash/DB; upgrade when abuse
// spans cold starts.
const STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
const STRIKE_LIMIT = 3;
const BLOCK_MS = 60 * 60 * 1000;

// actor -> [{ reason, at }] (at = epoch ms).
const strikes = new Map();

const validActor = (actor) => typeof actor === "string" && actor.length > 0;

const prune = (actor, nowMs) => {
  const list = strikes.get(actor) || [];
  const kept = list.filter((s) => s.at > nowMs - STRIKE_WINDOW_MS);
  if (kept.length === 0) strikes.delete(actor);
  else strikes.set(actor, kept);
  return kept;
};

const recordStrike = (actor, reason, { nowMs = Date.now() } = {}) => {
  if (!validActor(actor)) return 0;
  const list = prune(actor, nowMs);
  list.push({ reason: typeof reason === "string" ? reason : "abuse", at: nowMs });
  strikes.set(actor, list);
  return list.length;
};

const strikeCount = (actor, { nowMs = Date.now() } = {}) => {
  if (!validActor(actor)) return 0;
  return prune(actor, nowMs).length;
};

const blockedUntilMs = (actor, { nowMs = Date.now() } = {}) => {
  if (!validActor(actor)) return 0;
  const list = prune(actor, nowMs);
  if (list.length < STRIKE_LIMIT) return 0;
  return list[list.length - 1].at + BLOCK_MS;
};

const isBlocked = (actor, { nowMs = Date.now() } = {}) =>
  blockedUntilMs(actor, { nowMs }) > nowMs;

module.exports = {
  STRIKE_WINDOW_MS,
  STRIKE_LIMIT,
  BLOCK_MS,
  recordStrike,
  strikeCount,
  isBlocked,
  blockedUntilMs,
  // Test seam only.
  _reset: () => strikes.clear(),
};
