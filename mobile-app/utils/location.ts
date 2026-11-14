// Fast location — cache-first, refine in the background.
//
// The complaint was "location fetch is too slow": every caller used
// to await a fresh GPS fix before showing anything. The fix is
// ordering, not accuracy: return the cached last-known position
// FIRST (memory → AsyncStorage 'lastCoords' → the OS last-known
// fix — all instant), then refine with a fresh fix in the background
// (Balanced accuracy, short timeout) and cache it. The final fix is
// exactly as accurate as before; only the time-to-first-fix changes.
//
// Guardian pins are the exception: a pin is only ever sent as LIVE
// when it is fresh (<= 2 min old). getLivePinFix() returns null
// rather than a stale pin, and the caller reports the pin as
// unsent instead of implying it can be found.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface CachedFix extends LatLng {
  timestamp: number;
}

const CACHE_KEY = 'lastCoords';
const FRESH_TIMEOUT_MS = 8000;
const PIN_MAX_AGE_MS = 2 * 60 * 1000;

let memoryCache: CachedFix | null = null;

/** One writer for the cache (memory + AsyncStorage, same shape the
 * dashboard seed already reads: {latitude, longitude, speed, timestamp}). */
export const cacheFix = async (fix: CachedFix): Promise<void> => {
  memoryCache = fix;
  await AsyncStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ ...fix, speed: null })
  ).catch(() => {});
};

/** Memory-only note (for callers that already persist the fix). */
export const noteFix = (fix: CachedFix): void => {
  memoryCache = fix;
};

export const readCachedFix = async (): Promise<CachedFix | null> => {
  if (memoryCache) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') {
      return null;
    }
    const fix: CachedFix = {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : 0,
    };
    memoryCache = fix;
    return fix;
  } catch {
    return null;
  }
};

export const getLastKnownFix = async (): Promise<CachedFix | null> => {
  try {
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    const fix: CachedFix = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      timestamp: pos.timestamp,
    };
    memoryCache = fix;
    return fix;
  } catch {
    return null;
  }
};

/** Awaited fresh fix, Balanced accuracy, short timeout. Never throws. */
export const getFreshFix = async (timeoutMs = FRESH_TIMEOUT_MS): Promise<CachedFix | null> => {
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!fresh) return null;
    const fix: CachedFix = {
      latitude: fresh.coords.latitude,
      longitude: fresh.coords.longitude,
      timestamp: Date.now(),
    };
    await cacheFix(fix);
    return fix;
  } catch {
    return null;
  }
};

/** Fire-and-forget refine: fresh fix in the background, cached on arrival. */
export const refineFixInBackground = (): void => {
  void getFreshFix();
};

/** Cache-first: instant fix now, fresh fix refining behind it. */
export const getFastFix = async (): Promise<CachedFix | null> => {
  const cached = (await readCachedFix()) ?? (await getLastKnownFix());
  refineFixInBackground();
  return cached;
};

/** For guardian pins: a fix fresh enough to send as live (<= 2 min).
 * Returns null rather than a stale pin. */
export const getLivePinFix = async (): Promise<CachedFix | null> => {
  const cached = (await readCachedFix()) ?? (await getLastKnownFix());
  if (cached && Date.now() - cached.timestamp <= PIN_MAX_AGE_MS) {
    refineFixInBackground();
    return cached;
  }
  return getFreshFix();
};
