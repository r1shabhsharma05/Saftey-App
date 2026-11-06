// 🛡️ Walking-route proxy route — thin by design; the OSRM logic lives
// in services/route.js.
//
// Deliberately UNAUTHENTICATED: it serves public routing data, the same
// class as /safe-places (the app calls it from the dashboard, which the
// user reaches after login, but the data itself is public map data).
// The abuse surface is bounded by the dedicated rate limiter (see
// middleware/rateLimit.js) plus the 10s upstream timeout. Coordinates are
// validated numbers interpolated into a fixed-host URL — no
// user-controlled host ever reaches the fetcher, so there is no SSRF
// surface here.
const express = require("express");
const { routeLimiter } = require("../middleware/rateLimit");
const { getWalkingRoute } = require("../services/route");
const { haversineKm } = require("../services/safePlaces");

const router = express.Router();

router.get("/route", routeLimiter, async (req, res) => {
  const fromLat = parseFloat(req.query.fromLat);
  const fromLng = parseFloat(req.query.fromLng);
  const toLat = parseFloat(req.query.toLat);
  const toLng = parseFloat(req.query.toLng);
  if (
    [fromLat, fromLng, toLat, toLng].some((v) => !Number.isFinite(v)) ||
    fromLat < -90 || fromLat > 90 || toLat < -90 || toLat > 90 ||
    fromLng < -180 || fromLng > 180 || toLng < -180 || toLng > 180
  ) {
    return res.status(400).json({ success: false, error: "Invalid coordinates" });
  }
  // The app only ever routes to a safe place within 20 km; a pair
  // thousands of km apart would make OSRM return megabytes of geometry
  // on an unauthenticated endpoint. 25 km leaves headroom over the
  // 20 km police radius and bounds the response size.
  if (haversineKm(fromLat, fromLng, toLat, toLng) > 25) {
    return res.status(400).json({ success: false, error: "Route distance exceeds 25 km" });
  }
  try {
    const route = await getWalkingRoute(fromLat, fromLng, toLat, toLng);
    return res.json({ success: true, ...route });
  } catch (err) {
    if (err && err.code === "NO_ROUTE") {
      return res.status(502).json({ success: false, error: "No walking route found" });
    }
    return res.status(502).json({ success: false, error: "Route lookup failed" });
  }
});

module.exports = router;
