export interface SafePlace {
  id: number;
  lat: number;
  lng: number;
  name: string;
  category: 'police' | 'hospital' | 'crowd' | 'university' | 'hostel' | 'other';
  distance?: number;
  priorityScore?: number;
  /** D15 v1 safety score — from the backend when the proxy answered,
   *  computed locally (scorePlaceLocal) on the direct-Overpass fallback. */
  safety?: SafetyScore;
}

export type SafetyBand = 'SAFE' | 'MODERATE' | 'LOW';

export interface SafetyScore {
  score: number;
  band: SafetyBand;
  reasons: string[];
}

// D15 — safety scoring v1 (rules). MIRROR of Backend/services/safetyScore.js
// (the backend is canonical): same bases, same bands, same reasons.
// tests/safetyScore.test.js pins the fixture values both sides must return.
const PLACE_BASE: Record<string, number> = {
  police: 90,
  hospital: 80,
  university: 75,
  hostel: 70,
  crowd: 60,
  other: 50,
};

const PLACE_LABEL: Record<string, string> = {
  police: 'Police station',
  hospital: 'Hospital',
  university: 'University',
  hostel: 'Hostel',
  crowd: 'Public place',
  other: 'Safe place',
};

export const bandForScore = (score: number): SafetyBand =>
  score >= 80 ? 'SAFE' : score >= 55 ? 'MODERATE' : 'LOW';

export const scorePlaceLocal = (input: {
  category?: string;
  distanceKm?: number | null;
  openNow?: boolean | null;
}): SafetyScore => {
  const category = PLACE_BASE[input.category ?? ''] !== undefined ? (input.category as string) : 'other';
  let score = PLACE_BASE[category];
  const reasons = [PLACE_LABEL[category]];
  if (input.openNow === true) {
    score += 10;
    reasons.push('Open now');
  } else if (input.openNow === false) {
    score -= 25;
    reasons.push('Closed now');
  }
  const d = input.distanceKm;
  if (typeof d === 'number' && Number.isFinite(d)) {
    if (d <= 1) score += 5;
    else if (d <= 3) score += 0;
    else if (d <= 5) score -= 5;
    else if (d <= 10) score -= 10;
    else score -= 15;
  }
  if (typeof d === 'number' && Number.isFinite(d)) {
    reasons.push(d < 1 ? `${Math.round(d * 1000)} m away` : `${d.toFixed(1)} km away`);
  }
  score = Math.max(0, Math.min(100, score));
  return { score, band: bandForScore(score), reasons };
};

// Walking-time exposure, same bands as the backend route score.
export const scoreRouteLocal = (input: { distanceM?: number; durationS?: number }): SafetyScore => {
  const durationS =
    typeof input.durationS === 'number' && Number.isFinite(input.durationS)
      ? Math.max(0, input.durationS)
      : 0;
  const score =
    durationS <= 300 ? 90 : durationS <= 600 ? 80 : durationS <= 900 ? 70 : durationS <= 1800 ? 55 : 40;
  const minutes = Math.max(1, Math.round(durationS / 60));
  return { score, band: bandForScore(score), reasons: [`${minutes} min walk`] };
};

// Route-map badge: the destination's safety matters more than the walk
// itself, so the place score weighs 0.6 against the route's 0.4.
// Display rule only — the backend never sees the destination place.
export const combineRouteSafety = (place: SafetyScore, route: SafetyScore): SafetyScore => {
  const score = Math.round(0.6 * place.score + 0.4 * route.score);
  return {
    score,
    band: bandForScore(score),
    reasons: [...place.reasons.slice(0, 2), route.reasons[0]],
  };
};

// A safety object is only trusted when it has the full v1 shape — a
// stale cache or a future backend change must never render a broken
// badge. Used for backend-supplied scores AND restored cached places.
export const isValidSafety = (s: unknown): s is SafetyScore =>
  !!s &&
  typeof s === 'object' &&
  Number.isFinite((s as SafetyScore).score) &&
  (s as SafetyScore).score >= 0 &&
  (s as SafetyScore).score <= 100 &&
  ((s as SafetyScore).band === 'SAFE' ||
    (s as SafetyScore).band === 'MODERATE' ||
    (s as SafetyScore).band === 'LOW') &&
  Array.isArray((s as SafetyScore).reasons);

// Attach a score to a place that lacks a valid one (direct-Overpass
// fallback, or a cache written before D15). Valid scores pass through
// untouched — this never re-scores the backend's answer.
export const withSafety = <
  T extends { category?: string; distanceKm?: number | null; openNow?: boolean | null; safety?: SafetyScore },
>(
  place: T
): T & { safety: SafetyScore } =>
  isValidSafety(place.safety)
    ? (place as T & { safety: SafetyScore })
    : {
        ...place,
        safety: scorePlaceLocal({
          category: place.category,
          distanceKm: place.distanceKm ?? null,
          openNow: place.openNow ?? null,
        }),
      };

export const getCategoryPriority = (category: SafePlace['category']) => {
  switch (category) {
    case 'police': return 5;
    case 'university': return 4;
    case 'hospital': return 3;
    case 'hostel': return 2;
    case 'crowd': return 2;
    default: return 1;
  }
};

// Haversine formula in meters
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const aRaw = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  // Clamp: near-antipodal points can push `a` a hair past 1 by rounding,
  // and sqrt(1 - a) would be NaN.
  const a = Math.min(1, Math.max(0, aRaw));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; 
};

// Bearing calculation
export const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const λ1 = lon1 * Math.PI / 180;
  const λ2 = lon2 * Math.PI / 180;

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360; 
};

export const getCardinalDirection = (bearing: number) => {
  const directions = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];
  if (!Number.isFinite(bearing)) return 'Unknown';
  return directions[Math.round(bearing / 45) % 8];
};

export const rankSafePlaces = (places: SafePlace[], userLat: number, userLng: number): SafePlace[] => {
  // Drop unusable coordinates first (a stale cache from an older app
  // version can carry missing lat/lng): their distance is NaN, and the
  // old `(score || 0)` sort collapsed NaN to 0 — the BEST score — so a
  // broken place ranked as the nearest escape target at "0m".
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) return [];
  const usable = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return usable.map(place => {
    const distance = calculateDistance(userLat, userLng, place.lat, place.lng);
    
    // Adjust distance mathematically based on safety category
    let perceivedDistance = distance;
    if (place.category === 'police') perceivedDistance *= 0.6;
    else if (place.category === 'university') perceivedDistance *= 0.65;
    else if (place.category === 'hospital') perceivedDistance *= 0.7;
    else if (place.category === 'hostel') perceivedDistance *= 0.8;
    else if (place.category === 'crowd') perceivedDistance *= 0.9;

    return {
      ...place,
      distance,
      priorityScore: perceivedDistance
    };
  }).sort((a, b) => (a.priorityScore || 0) - (b.priorityScore || 0));
};
