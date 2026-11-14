// Police layer client — SafeLife 2.0 Day 22 (plan §6 D22, plan §3 F2).
//
// Thin client for GET /police/nearest: the single nearest police
// station for the SOS screen. The endpoint is public map data (no API
// key, like /safe-places); the fetch has a 30 s timeout, same as the
// guardian client, because a cold Overpass cell can take ~20 s
// server-side. A non-200 or a transport failure throws — the caller
// shows "Station data unavailable" and the 112 button, never a fake
// station. `station: null` is the honest empty (no station within
// 20 km), not an error.
import { getBackendUrl } from './backendUrl';
import type { SafetyScore } from './escapeLogic';

/** India's single emergency number — a constant, not a lookup. */
export const EMERGENCY_NUMBER = '112';

export interface PoliceStation {
  name: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  openNow: boolean | null;
  safety?: SafetyScore;
}

export interface NearestPoliceResult {
  station: PoliceStation | null;
  emergencyNumber: string;
  reason?: string;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isValidPoliceStation = (v: unknown): v is PoliceStation => {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    (typeof s.name === 'string' || s.name === null) &&
    (typeof s.phone === 'string' || s.phone === null) &&
    isFiniteNumber(s.lat) &&
    isFiniteNumber(s.lng) &&
    isFiniteNumber(s.distanceKm) &&
    (typeof s.openNow === 'boolean' || s.openNow === null)
  );
};

/** "450m" / "2.3km" — same shape as the home screen's Police Radar. */
export const formatPoliceDistance = (distanceKm: number): string =>
  distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`;

export const fetchNearestPoliceStation = async (
  lat: number,
  lng: number
): Promise<NearestPoliceResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      `${getBackendUrl()}/police/nearest?lat=${lat}&lng=${lng}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      throw new Error(`Police lookup failed (${response.status})`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (!isValidPoliceStation(body.station) && body.station !== null) {
      throw new Error('Police lookup returned an unexpected shape');
    }
    return {
      station: (body.station as PoliceStation | null) ?? null,
      emergencyNumber:
        typeof body.emergencyNumber === 'string' ? body.emergencyNumber : EMERGENCY_NUMBER,
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
};
