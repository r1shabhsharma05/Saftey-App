// Backend base URL resolution — HTTPS-everywhere.
//
// The SOS flow POSTs the user's name, phone number and live GPS coordinates,
// so it must never travel over plaintext HTTP in a production build. There
// is deliberately no silent fallback: a missing or insecure URL fails fast
// with a clear message instead of quietly downgrading to an unencrypted
// dev address (the old code fell back to http://<lan-ip>:5000).

declare const __DEV__: boolean;

const RAW_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function schemeAllowed(url: string): boolean {
  if (url.startsWith('https://')) return true;
  // Plain HTTP is only ever acceptable for local development, where the
  // phone talks to a dev server on the LAN. Production builds must use https.
  if (__DEV__ && url.startsWith('http://')) return true;
  return false;
}

export function getBackendUrl(): string {
  if (!RAW_URL) {
    throw new Error(
      'EXPO_PUBLIC_BACKEND_URL is not set — SOS alerts have nowhere to go. ' +
        'Copy mobile-app/.env.example to .env and set it (https://… in production).'
    );
  }
  const url = RAW_URL.replace(/\/+$/, '');
  if (!schemeAllowed(url)) {
    throw new Error(
      `Refusing insecure backend URL "${url}" in a production build — use https://. ` +
        'http:// is for local dev only (see mobile-app/.env.example).'
    );
  }
  return url;
}
