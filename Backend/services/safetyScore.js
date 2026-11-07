// 🛡️ Safety scoring v1 (rules) — SafeLife 2.0 Day 15.
//
// Transparent, rule-based scores (plan §7 F7: v1 is rules + scoring, no
// trained model and no invented data). One table, two implementations:
// this file is canonical; mobile-app/utils/escapeLogic.ts mirrors it
// for the phone's direct-Overpass fallback path, and the fixture values
// in tests/safetyScore.test.js are the parity contract between them.
//
// Place score (0-100) = type base + open-now + distance. Route score
// (0-100) = walking-time exposure only — a route's safety also depends
// on its destination, which the backend cannot know from coordinates
// alone, so the app blends place + route (0.6 / 0.4) for the badge it
// shows on the route map.
// Deliberately NOT in v1: a time-of-day / night factor. The backend
// runs on UTC and cannot know the user's local time without a new
// timezone input; adding it server-side would score the wrong hours
// for the India user base. D29 (ML v1) candidate, once the input exists.
// shortcut: no incident-density factor — no public incident source is
// wired in; upgrade when a real source exists, never from invented data.
const PLACE_BASE = {
  police: 90,
  hospital: 80,
  university: 75,
  hostel: 70,
  crowd: 60,
  other: 50,
};

const PLACE_LABEL = {
  police: "Police station",
  hospital: "Hospital",
  university: "University",
  hostel: "Hostel",
  crowd: "Public place",
  other: "Safe place",
};

const bandFor = (score) => (score >= 80 ? "SAFE" : score >= 55 ? "MODERATE" : "LOW");

// Same tag → category order as the mobile parser
// (mobile-app/app/(tabs)/index.tsx): police, university, hospital,
// hostel, crowd. The app's name-based special cases (e.g. "GLA
// University") live app-side only; tags alone decide here.
const categoryFromTags = (tags) => {
  const amenity = (tags && tags.amenity) || "";
  const tourism = (tags && tags.tourism) || "";
  const shop = (tags && tags.shop) || "";
  if (amenity.includes("police")) return "police";
  if (amenity.includes("university") || amenity.includes("college")) return "university";
  if (amenity.includes("hospital") || amenity.includes("clinic")) return "hospital";
  if (tourism.includes("hostel") || tourism.includes("hotel")) return "hostel";
  if (
    amenity.includes("mall") ||
    amenity.includes("cafe") ||
    amenity.includes("bank") ||
    amenity.includes("pharmacy") ||
    shop !== ""
  ) {
    return "crowd";
  }
  return "other";
};

const distanceLabel = (distanceKm) => {
  if (distanceKm === null || distanceKm === undefined) return null;
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m away`
    : `${distanceKm.toFixed(1)} km away`;
};

const scorePlace = (input = {}) => {
  const category = PLACE_BASE[input.category] !== undefined ? input.category : "other";
  let score = PLACE_BASE[category];
  const reasons = [PLACE_LABEL[category]];
  if (input.openNow === true) {
    score += 10;
    reasons.push("Open now");
  } else if (input.openNow === false) {
    score -= 25;
    reasons.push("Closed now");
  }
  const d = input.distanceKm;
  if (typeof d === "number" && Number.isFinite(d)) {
    if (d <= 1) score += 5;
    else if (d <= 3) score += 0;
    else if (d <= 5) score -= 5;
    else if (d <= 10) score -= 10;
    else score -= 15;
  }
  const label = distanceLabel(d);
  if (label) reasons.push(label);
  score = Math.max(0, Math.min(100, score));
  return { score, band: bandFor(score), reasons };
};

// Walking-time exposure: a longer walk is longer exposure. Duration
// bands only — distance alone says nothing about the walk (a 3 km
// straight path and a 3 km winding one score the same by metres).
const scoreRoute = (input = {}) => {
  const durationS = typeof input.durationS === "number" && Number.isFinite(input.durationS)
    ? Math.max(0, input.durationS)
    : 0;
  const score =
    durationS <= 300 ? 90 : durationS <= 600 ? 80 : durationS <= 900 ? 70 : durationS <= 1800 ? 55 : 40;
  const minutes = Math.max(1, Math.round(durationS / 60));
  return { score, band: bandFor(score), reasons: [`${minutes} min walk`] };
};

module.exports = { scorePlace, scoreRoute, bandFor, categoryFromTags };
