export interface SafePlace {
  id: number;
  lat: number;
  lng: number;
  name: string;
  category: 'police' | 'hospital' | 'crowd' | 'university' | 'hostel' | 'other';
  distance?: number;
  priorityScore?: number;
}

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
