// 🧠 Risk-score route — thin by design; the scoring lives in
// services/riskScore.js (SafeLife 2.0 Day 29, plan §3 F7).
//
// Deliberately UNAUTHENTICATED, same class as /route and
// /safe-places: it is a pure computation over caller-supplied
// numbers — no stored data is read, nothing is written except the
// anonymised feature row (services/featureLog.js), and the app may
// call it from pre-login surfaces. The abuse surface is bounded by
// the shared routeLimiter bucket (30/min) and the 32 kb JSON cap in
// server.js. Every input is a bounded number or an allowlisted
// enum; unknown fields are ignored, never echoed.
const express = require("express");
const { routeLimiter } = require("../middleware/rateLimit");
const { scoreRisk, AREA_TYPES } = require("../services/riskScore");
const { logFeatureEvent } = require("../services/featureLog");

const router = express.Router();

const numOrUndef = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

router.post("/risk-score", routeLimiter, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const input = {
    localHour: numOrUndef(body.localHour),
    tz: typeof body.tz === "string" ? body.tz.slice(0, 64) : undefined,
    areaType: AREA_TYPES.includes(body.areaType) ? body.areaType : undefined,
    routeDurationS: numOrUndef(body.routeDurationS),
    routeDistanceM: numOrUndef(body.routeDistanceM),
    deviationM: numOrUndef(body.deviationM),
  };
  const result = scoreRisk(input);
  // Anonymised training row (kind risk_score). lat/lng are optional
  // and stored only as a ~1.1 km cell — see featureLog.js.
  logFeatureEvent({ kind: "risk_score", lat: numOrUndef(body.lat), lng: numOrUndef(body.lng), input });
  return res.json({ success: true, ...result });
});

module.exports = router;
