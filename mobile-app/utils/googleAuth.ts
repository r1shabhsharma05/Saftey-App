import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { parseAuthDeepLink } from './deepLink';

WebBrowser.maybeCompleteAuthSession();

// Google sign-in, native-first.
//
// The old login/register code called supabase.auth.signInWithOAuth on its
// own — a web-only pattern: it returns the provider URL but nothing opens
// it, so on Android the button silently did nothing. The native flow is:
// build the URL (skipBrowserRedirect), open it in an auth browser
// session, and complete the session from what Supabase redirects back
// to the app's scheme (safelifeai://auth-callback).
//
// supabase-js v2 defaults to the PKCE flow, so the redirect carries
// ?code=... which must be EXCHANGED for a session — an earlier version
// of this file only looked for implicit-flow tokens (access_token /
// refresh_token), which a PKCE redirect never contains, so every native
// Google sign-in failed with "did not return a session". Only the PKCE
// code is handled below (H1): implicit tokens in a redirect URL are
// never accepted, and the result URL must be the redirect this call
// opened (our scheme + auth-callback) — a stray or foreign URL is not
// consumed.
//
// Returns {} on success (the root layout's auth listener navigates to
// the tabs) and on user cancellation; { error } with a user-safe message
// otherwise.
export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    return { error: error ? friendly(error.message) : undefined };
  }

  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { error: friendly(error.message) };
  if (!data?.url) return { error: 'Google sign-in could not be started. Please try again.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return {}; // user cancelled — not an error

  // (H1) The result must be the redirect this call opened — our scheme
  // + auth-callback — carrying a PKCE code. Anything else (a foreign
  // URL, an implicit-token link) is not consumed.
  const link = parseAuthDeepLink(result.url, 'auth-callback');
  if (!link || link.error) {
    return { error: link?.error ? friendly(link.error) : 'Google sign-in did not return a session. Please try again.' };
  }
  if (!link.code) {
    return { error: 'Google sign-in did not return a session. Please try again.' };
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(link.code);
  return { error: exchangeError ? friendly(exchangeError.message) : undefined };
}

function friendly(message: string): string {
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return 'Google sign-in is not switched on for this app yet. Please use email sign-in for now.';
  }
  return message;
}
