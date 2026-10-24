// 🛡️ Safe-places proxy route — thin by design; the Overpass logic lives
// in services/safePlaces.js.
//
// Deliberately UNAUTHENTICATED: it serves public map data (police
// stations, hospitals) and the app calls it before login. The abuse
// surface is bounded by the dedicated rate limiter (see
// middleware/rateLimit.js) plus the 5-minute grid cache sitting between
// callers and the upstream Overpass mirrors.
const express = require("express");
const { safePlacesLimiter } = require("../middleware/rateLimit");
const { lookupSafePlaces } = require("../services/safePlaces");

const router = express.Router();

router.get("/safe-places", safePlacesLimiter, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return res.status(400).json({ success: false, error: "Invalid coordinates" });
  }
  try {
    const { data } = await lookupSafePlaces(lat, lng);
    // Keeps Overpass's shape ({ elements: [...] }) so the app's existing
    // parser works unchanged.
    return res.json(data);
  } catch (err) {
    const status = err && err.status === 502 ? 502 : 500;
    return res.status(status).json({ success: false, error: "Safe places lookup failed" });
  }
});

module.exports = router;
