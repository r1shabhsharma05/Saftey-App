// 🧠 ML v1 risk scoring — SafeLife 2.0 Day 29 (plan §3 F7, §6 D29).
//
// Rules first, model later — exactly as the plan orders: v1 is a
// transparent weighted sum over a FIXED-ORDER feature vector, so a
// trained model can replace the sum later without any API or caller
// change (same vector in, same {score, band, reasons} out).
//
// Route risk = time-of-day × area type × route exposure × deviation
// × historical incident density (plan F7). One factor is honestly
// absent: there is NO wired incident-density source, so that feature
// is null with known:false and weight 0 — an unknown reading never
// counts as evidence of safety (it is named in unknownFactors, and
// the day a real source exists it only fills the slot).
//
// Time-of-day needs the USER's local hour: the backend runs on UTC,
// so the caller passes localHour (0-23) or an IANA tz the hour is
// derived from. Without either, the factor is unknown — never
// guessed from server time (that was D15's deliberate omission in
// safetyScore.js; D29 is where the input finally exists).
//
// Pure module, no I/O. safetyScore.js (D15) stays canonical for
// place/route SAFETY (high = safe); this file scores RISK
// (high = riskier) for journeys and SOS priority.
const MODEL_VERSION = "rules-v1";

// Fixed-order feature contract — model v2 consumes exactly this.
const FEATURE_ORDER = [
  "hourOfDay",
  "isNight",
  "areaType",
  "routeDurationS",
  "routeDistanceM",
  "deviationM",
  "incidentDensity",
];

const AREA_TYPES = ["police", "hospital", "university", "hostel", "crowd", "other"];

// Area risk base (0-100): busier/watched areas score lower. Mirrors
// D15's PLACE_BASE ordering inverted — a police-station area is the
// safest place to be, an unclassified area the least known.
const AREA_RISK = { police: 5, hospital: 15, university: 20, hostel: 25, crowd: 30, other: 45 };

// One weights table = the whole "model". A trained model replaces
// these numbers (or the sum below) behind the same interface.
const WEIGHTS = {
  night: 25, // walking at 2 am is not walking at 2 pm
  evening: 10, // 18-22: dimming, crowds thinning
  durationPer10Min: 4, // exposure: longer walk = longer risk window
  durationCap: 20,
  deviationPer100m: 3, // off-route metres (journey watch, D17)
  deviationCap: 25,
  incidentDensity: 0, // no source wired — see header; never invented
};

const bandForRisk = (score) => (score >= 65 ? "HIGH" : score >= 40 ? "MODERATE" : "LOW");

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The user's local hour: explicit localHour wins; else derive from a
// valid IANA tz; else unknown (null) — server UTC is never passed
// off as the user's time.
const localHourOf = (input) => {
  const h = finite(input.localHour);
  if (h !== null && h >= 0 && h <= 23) return Math.floor(h);
  if (typeof input.tz === "string" && input.tz.length > 0 && input.tz.length <= 64) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: input.tz,
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date());
      const hour = parts.find((p) => p.type === "hour");
      const v = hour ? parseInt(hour.value, 10) % 24 : null;
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
};

// Extracts the fixed-order feature vector + per-factor known flags.
// Every value is clamped to a sane range here, once, so the scorer
// and the feature logger (services/featureLog.js) see identical
// numbers — the logger stores exactly what the scorer consumed.
const extractFeatures = (input = {}) => {
  const hour = localHourOf(input);
  const areaType = AREA_TYPES.includes(input.areaType) ? input.areaType : "other";
  const durationS = finite(input.routeDurationS);
  const distanceM = finite(input.routeDistanceM);
  const deviationM = finite(input.deviationM);
  const features = {
    hourOfDay: hour,
    isNight: hour === null ? null : hour >= 22 || hour < 5,
    areaType,
    routeDurationS: durationS === null ? null : Math.max(0, Math.min(86400, durationS)),
    routeDistanceM: distanceM === null ? null : Math.max(0, Math.min(100000, distanceM)),
    deviationM: deviationM === null ? null : Math.max(0, Math.min(50000, deviationM)),
    // No incident source is wired (see header). A caller-supplied
    // number is still recorded in the vector for model v2, but
    // rules-v1 weights it 0 and known stays false until a real
    // source feeds it server-side.
    incidentDensity: finite(input.incidentDensity),
  };
  const known = {
    hourOfDay: hour !== null,
    areaType: AREA_TYPES.includes(input.areaType),
    routeDurationS: features.routeDurationS !== null,
    routeDistanceM: features.routeDistanceM !== null,
    deviationM: features.deviationM !== null,
    incidentDensity: false,
  };
  return { features, known };
};

const scoreRisk = (input = {}) => {
  const { features, known } = extractFeatures(input);
  const reasons = [];
  const unknownFactors = [];

  let score = AREA_RISK[features.areaType];
  reasons.push(`Area: ${features.areaType}`);

  if (known.hourOfDay) {
    if (features.isNight) {
      score += WEIGHTS.night;
      reasons.push("Night hours");
    } else if (features.hourOfDay >= 18) {
      score += WEIGHTS.evening;
      reasons.push("Evening hours");
    } else {
      reasons.push("Daytime");
    }
  } else {
    unknownFactors.push("time-of-day");
  }

  if (known.routeDurationS) {
    const add = Math.min(
      WEIGHTS.durationCap,
      Math.floor(features.routeDurationS / 600) * WEIGHTS.durationPer10Min
    );
    score += add;
    reasons.push(`${Math.max(1, Math.round(features.routeDurationS / 60))} min walk`);
  } else {
    unknownFactors.push("route-duration");
  }

  if (known.deviationM && features.deviationM > 0) {
    const add = Math.min(
      WEIGHTS.deviationCap,
      Math.floor(features.deviationM / 100) * WEIGHTS.deviationPer100m
    );
    score += add;
    reasons.push(`${Math.round(features.deviationM)} m off route`);
  }

  // Incident density: unknown by design until a real source exists.
  // Named, never scored as zero-risk evidence.
  unknownFactors.push("incident-density");

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    band: bandForRisk(score),
    reasons,
    features,
    unknownFactors,
    modelVersion: MODEL_VERSION,
  };
};

module.exports = { scoreRisk, extractFeatures, bandForRisk, FEATURE_ORDER, AREA_TYPES, WEIGHTS, MODEL_VERSION };
