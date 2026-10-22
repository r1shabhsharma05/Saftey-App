// 🛡️ Per-route rate limiting for the SafeLife backend.
//
// Why express-rate-limit instead of hand-rolled: it already handles the
// sharp edges (IPv6 keying, trust-proxy validation, standard RateLimit-*
// headers, a correct Retry-After). Rolling our own would re-invent those.
//
// NOTE on Vercel: the default memory store is per serverless instance, so
// a flood spread across many cold starts is only partially throttled.
// Still a real improvement over no limiting, and fully correct for the
// single-instance local case. A shared store (e.g. Redis/Upstash) is the
// documented next step if abuse ever warrants it.
//
// IMPORTANT: server.js sets `trust proxy` (1 hop) so req.ip is the real
// client IP behind Vercel's edge. Without it every request would share a
// single bucket and one bad actor could lock out all users.
const { rateLimit } = require("express-rate-limit");

// The API speaks JSON everywhere, so 429s are JSON too (with Retry-After).
const jsonHandler = (req, res) => {
  const resetTime = req.rateLimit && req.rateLimit.resetTime;
  const retryAfter = resetTime
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
    : 60;
  res.set("Retry-After", String(retryAfter));
  res.status(429).json({
    success: false,
    error: "Too many requests — please try again shortly.",
  });
};

const baseOptions = {
  standardHeaders: "draft-7", // RateLimit-Limit/Remaining/Reset headers
  legacyHeaders: false, // no X-RateLimit-* legacy headers
  handler: jsonHandler,
};

// 🚨 SOS alerts: each hit spams the user's Telegram contacts, so a cap
// must exist — but 5/15min was an emergency hazard: Indian carriers put
// many subscribers behind one NAT egress IP (trust proxy keys the bucket
// on that shared IP), and a panicking user re-presses SOS. 30/15min per
// IP still stops floods while never locking out a real emergency.
const sosLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 30,
});

// 📡 Live location updates: no client sends these yet, but live tracking
// legitimately updates every few seconds — 60/min (~1/sec average) is
// generous while still stopping floods.
const trackingLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 60,
});

// 🧪 Test alerts: debugging only — 10/hour is plenty.
const testLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
});

module.exports = { sosLimiter, trackingLimiter, testLimiter };
