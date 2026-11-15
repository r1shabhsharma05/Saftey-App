// Fast location — cache-first, refine in the background.
//
// The complaint was "location fetch is too slow": every caller used
// to await a fresh GPS fix before showing anything. The fix is
// ordering, not accuracy: return the cached last-known position
// FIRST (memory → SecureStore 'lastCoords' → the OS last-known
// fix — all instant), then refine with a fresh fix in the background
// (Balanced accuracy, short timeout) and cache it. The final fix is
// exactly as accurate as before; only the time-to-first-fix changes.
//
// The cache lives in SecureStore (via utils/secureStorage.ts), NOT
// plaintext AsyncStorage: a last-known fix is precise PII — a rooted
// device / backup read must not find the user's coordinates in the
// clear (run-3 F-13.1). A pre-fix plaintext copy is migrated once by
// secureGetItem (copied to SecureStore, deleted from AsyncStorage).
//
// Throttle (why): cacheFix is called on every GPS fix, and
// SecureStore is a keychain/keystore round-trip, not a free file
// write — persisting every fix would hammer it. So the in-memory
// cache updates on every fix, but the SecureStore write happens
// only when the fix moved materially (> ~50 m) or at least 60 s
// have passed since the last persist. A restart within that window
// seeds from a fix at most 60 s / 50 m stale — fine for a "last
// known" seed; live pins always use getLivePinFix()/getFreshFix().
import * as Location from 'expo-location';
import { secureGetItem, secureSetItem } from './secureStorage';

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
// Persist at most once a minute, or sooner if the fix moved > ~50 m
// (0.00045° ≈ 50 m at the equator — cheap box check, no haversine).
const PERSIST_MIN_INTERVAL_MS = 60 * 1000;
const PERSIST_MIN_MOVE_DEG = 0.00045;

let memoryCache: CachedFix | null = null;
let lastPersistedFix: CachedFix | null = null;
let lastPersistAtMs = 0;

/** One writer for the cache (memory always; SecureStore throttled —
 * see the header note — same shape the dashboard seed already
 * reads: {latitude, longitude, speed, timestamp}). */
export const cacheFix = async (fix: CachedFix): Promise<void> => {
  memoryCache = fix;
  const now = Date.now();
  const moved =
    !lastPersistedFix ||
    Math.abs(fix.latitude - lastPersistedFix.latitude) > PERSIST_MIN_MOVE_DEG ||
    Math.abs(fix.longitude - lastPersistedFix.longitude) > PERSIST_MIN_MOVE_DEG;
  if (!moved && now - lastPersistAtMs < PERSIST_MIN_INTERVAL_MS) return;
  lastPersistedFix = fix;
  lastPersistAtMs = now;
  await secureSetItem(CACHE_KEY, JSON.stringify({ ...fix, speed: null })).catch(() => {});
};

/** Memory-only note (for callers that already persist the fix). */
export const noteFix = (fix: CachedFix): void => {
  memoryCache = fix;
};

export const readCachedFix = async (): Promise<CachedFix | null> => {
  if (memoryCache) return memoryCache;
  try {
    const raw = await secureGetItem(CACHE_KEY);
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
