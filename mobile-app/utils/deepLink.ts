import * as Linking from 'expo-linking';

// Deep-link validation for auth callbacks (audit H1).
//
// A deep link is attacker-controlled input: any app on the device can
// fire safelifeai://... with arbitrary query/hash params, and a link
// is not proof that the user just completed a flow. Two rules before
// ANY param is trusted:
//   1. The URL must use our own scheme (safelifeai://) — nothing else.
//   2. Its hostname must be the route this screen owns
//      (auth-callback / reset-password) — a link meant for another
//      route must not be consumed here.
// Only then is the PKCE code read (query first, hash as a fallback —
// Supabase puts the code in the query). Implicit-flow tokens
// (access_token / refresh_token in the URL) are NEVER accepted:
// they are bearer credentials any app could have pasted into a link,
// while a PKCE code is useless without the verifier the app holds
// (supabase-js keeps it in secure storage for the exchange).

export const APP_SCHEME = 'safelifeai';

export function parseAuthDeepLink(
  url: string,
  route: 'auth-callback' | 'reset-password'
): { code?: string; error?: string } | null {
  let parsed: Linking.ParsedURL;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }
  if (parsed.scheme !== APP_SCHEME) return null;
  if (parsed.hostname !== route) return null;

  const queryParams = parsed.queryParams ?? {};
  const hash = url.includes('#') ? url.split('#')[1] : '';
  const hashParams = new URLSearchParams(hash);
  const get = (key: string): string | undefined => {
    const fromQuery = queryParams[key];
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
    const fromHash = hashParams.get(key);
    return fromHash || undefined;
  };
  const error = get('error_description') ?? get('error');
  const code = get('code');
  return { code, error };
}
