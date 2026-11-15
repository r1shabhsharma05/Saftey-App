// Force-update gate (H18): on launch the app asks the backend
// GET /version for { minSupportedVersion, latestVersion } and
// blocks with a full-screen notice (no bypass) when the running
// build is below minSupportedVersion. Fail-open: a version check
// that never reaches the server (offline, timeout, malformed
// answer) does NOT block the app — only a positive "you are below
// min" from the server blocks. The current version comes from
// app.json via expo-constants (no new dependency).
import Constants from 'expo-constants';

export const PLAY_STORE_URL =
  // H18: SafeLife is NOT on the Play Store — it ships as an APK from
  // GitHub Releases. The old Play Store URL was a dead path: APK
  // users tapping Update landed on a listing that does not exist.
  // Point the force-update button at the real download instead.
  'https://github.com/r1shabhsharma05/Saftey-App/releases/latest';

export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** Tiny semver compare, no dependency: -1 | 0 | 1. Missing parts
 * count as 0 ("1.2" == "1.2.0"); non-numeric suffixes are ignored
 * ("1.2.3-beta" compares as 1.2.3). Unparseable input sorts below
 * any real version so a bad server value can never block a good app. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+(?:\.\d+)*)/.exec(v.trim());
    if (!m) return null;
    return m[1].split('.').map(Number);
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface VersionCheckResult {
  /** True only when the server positively answered and this build
   * is below minSupportedVersion. False covers "up to date" AND
   * "check failed" (fail-open — see header note). */
  updateRequired: boolean;
  minSupportedVersion?: string;
  latestVersion?: string;
}

/** GET {backendUrl}/version (public, 10 s timeout). Never throws. */
export async function checkForceUpdate(backendUrl: string): Promise<VersionCheckResult> {
  const current = getAppVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${backendUrl}/version`, { signal: controller.signal });
    if (!response.ok) return { updateRequired: false };
    const data = (await response.json().catch(() => null)) as {
      minSupportedVersion?: unknown;
      latestVersion?: unknown;
    } | null;
    if (!data || typeof data.minSupportedVersion !== 'string') return { updateRequired: false };
    const updateRequired = compareSemver(current, data.minSupportedVersion) < 0;
    return {
      updateRequired,
      minSupportedVersion: data.minSupportedVersion,
      latestVersion:
        typeof data.latestVersion === 'string' ? data.latestVersion : undefined,
    };
  } catch {
    return { updateRequired: false };
  } finally {
    clearTimeout(timeout);
  }
}
