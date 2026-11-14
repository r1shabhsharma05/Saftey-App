// 🛡️ Police layer — SafeLife 2.0 Day 22 (plan §6 D22, plan §3 F2).
//
// Pure nearest-station pick over the D13 safe-places payload: the
// Overpass query already returns police within 20 km, annotated with
// distanceKm / openNow / D15 safety. This module only filters, ranks
// and shapes — no network, no storage, no new dependency. The route
// (routes/police.js) owns the lookup; the SOS screen owns the dial.
const { categoryFromTags } = require("./safetyScore");
const { haversineKm } = require("./safePlaces");

// India's single emergency number — a constant, not a lookup.
const EMERGENCY_NUMBER = "112";

// OSM phone tags are crowd-edited text — same allowlist the mobile
// parser uses (mobile-app/utils/escapeLogic.ts sanitizePhone):
// optional +, digits, spaces, dashes, parens, 7–20 chars. Anything
// else → null, so a URL, a note or a USSD code can never reach tel:.
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{5,18}$/;

const extractStationPhone = (tags) => {
  if (!tags || typeof tags !== "object") return null;
  const raw = tags.phone || tags["contact:phone"];
  if (typeof raw !== "string") return null;
  const phone = raw.trim();
  return PHONE_RE.test(phone) ? phone : null;
};

const elementCoords = (el) => {
  const lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
  const lng = el.lon !== undefined ? el.lon : el.center && el.center.lon;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

// Nearest police station in an annotated safe-places payload, or null
// — never a fake station. Distance comes from the annotation when
// present (exact query point, recomputed per request by D13), else
// haversine from the element coords. Ties break toward open, then
// toward the higher D15 safety score.
const nearestPoliceStation = (elements, lat, lng) => {
  if (!Array.isArray(elements)) return null;
  let best = null;
  for (const el of elements) {
    if (!el || categoryFromTags(el.tags) !== "police") continue;
    const coords = elementCoords(el);
    if (!coords) continue;
    const distanceKm =
      typeof el.distanceKm === "number" && Number.isFinite(el.distanceKm)
        ? Math.round(el.distanceKm * 100) / 100
        : Math.round(haversineKm(lat, lng, coords.lat, coords.lng) * 100) / 100;
    const candidate = {
      name:
        el.tags && typeof el.tags.name === "string" && el.tags.name.trim()
          ? el.tags.name.trim()
          : null,
      phone: extractStationPhone(el.tags),
      lat: coords.lat,
      lng: coords.lng,
      distanceKm,
      openNow: el.openNow === true ? true : el.openNow === false ? false : null,
      safety: el.safety && typeof el.safety === "object" ? el.safety : null,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    if (candidate.distanceKm < best.distanceKm - 1e-9) {
      best = candidate;
      continue;
    }
    if (Math.abs(candidate.distanceKm - best.distanceKm) <= 1e-9) {
      if (candidate.openNow === true && best.openNow !== true) {
        best = candidate;
        continue;
      }
      if (candidate.openNow === best.openNow) {
        const cs = candidate.safety && candidate.safety.score;
        const bs = best.safety && best.safety.score;
        if (typeof cs === "number" && (typeof bs !== "number" || cs > bs)) {
          best = candidate;
        }
      }
    }
  }
  return best;
};

module.exports = { EMERGENCY_NUMBER, extractStationPhone, nearestPoliceStation };
