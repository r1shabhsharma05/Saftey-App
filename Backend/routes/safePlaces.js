// 🛡️ Safe-places proxy route — thin by design; the Overpass logic lives
// in services/safePlaces.js.
//
// Deliberately UNAUTHENTICATED: it serves public map data (police
// stations, hospitals) and the app calls it before login. The abuse
// surface is bounded by the dedicated rate limiter (see
// middleware/rateLimit.js) plus the 5-minute grid cache (memory, then
// shared Upstash) sitting between callers and the upstream mirrors.
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
    // openNow=1 drops only definitively-closed places (unknown hours
    // stay); the default response is unchanged, elements annotated.
    const openNow = req.query.openNow === "1" || req.query.openNow === "true";
    // M4: the caller may pass its IANA timezone (?tz=Asia/Kolkata)
    // so openNow is judged in the place's local time, not the
    // server's. Validated: an unknown zone is ignored (openNow stays
    // unknown) rather than failing the lookup — a lookup with unknown
    // hours beats a failed lookup.
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
    const { data, source } = await lookupSafePlaces(lat, lng, { openNow, timeZone });
    // Cache tier is header-only: the body keeps Overpass's shape
    // ({ elements: [...] }) so the app's existing parser works unchanged.
    res.set("X-SafePlaces-Cache", source);
    return res.json(data);
  } catch (err) {
    const status = err && err.status === 502 ? 502 : 500;
    return res.status(status).json({ success: false, error: "Safe places lookup failed" });
  }
});

module.exports = router;
