// 🛡️ Nearest-police-station route — thin by design; the Overpass logic
// lives in services/safePlaces.js, the pick in services/police.js.
//
// Deliberately UNAUTHENTICATED: it serves public map data (police
// stations), the same class as /safe-places (the SOS screen calls it
// while an alert is active, and the data itself is public). The abuse
// surface is bounded by the dedicated rate limiter (see
// middleware/rateLimit.js) plus the 5-minute grid cache (memory, then
// shared Upstash) sitting between callers and the upstream mirrors.
const express = require("express");
const { safePlacesLimiter } = require("../middleware/rateLimit");
const { lookupSafePlaces } = require("../services/safePlaces");
const { EMERGENCY_NUMBER, nearestPoliceStation } = require("../services/police");

const router = express.Router();

router.get("/police/nearest", safePlacesLimiter, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return res.status(400).json({ success: false, error: "Invalid coordinates" });
  }
  try {
    // M4 (same as /safe-places): the caller may pass its IANA timezone
    // (?tz=Asia/Kolkata) so openNow is judged in the place's local time.
    // An unknown zone is ignored rather than failing the lookup.
    let timeZone;
    const tz = req.query.tz;
    if (typeof tz === "string" && tz.length > 0 && tz.length <= 64) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        timeZone = tz;
      } catch {
        timeZone = undefined;
      }
    }
    const { data, source } = await lookupSafePlaces(lat, lng, { timeZone });
    const station = nearestPoliceStation(data.elements, lat, lng);
    // Cache tier is header-only, same as /safe-places.
    res.set("X-SafePlaces-Cache", source);
    return res.json({
      station,
      emergencyNumber: EMERGENCY_NUMBER,
      // No station within 20 km is an honest empty, never a fake one —
      // the SOS screen still shows the 112 button (see utils/police.ts).
      ...(station ? {} : { reason: "no-police-station-nearby" }),
    });
  } catch (err) {
    const status = err && err.status === 502 ? 502 : 500;
    return res.status(status).json({ success: false, error: "Safe places lookup failed" });
  }
});

module.exports = router;
