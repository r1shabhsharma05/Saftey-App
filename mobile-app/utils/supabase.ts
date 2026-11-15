import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { secureGetItem, secureSetItem, secureRemoveItem } from './secureStorage';

// (M2) The session lives in the OS keychain/keystore via
// expo-secure-store, not plaintext AsyncStorage: the stored tokens
// are what an attacker needs to impersonate the user. Web has no
// keychain, so tokens live only in memory (see secureStorage.ts) —
// a refresh forces re-login. A pre-M2 session still in AsyncStorage
// is migrated once on first read — no user is logged out by the move.

// 🚀 SUPABASE CONFIGURATION
// The anon key is publishable, but it is NOT inlined here: the single
// source is eas.json (preview + production env blocks) / the
// EXPO_PUBLIC_SUPABASE_ANON_KEY env var (see mobile-app/.env.example).
// A missing key fails fast with a clear message instead of silently
// falling back to a stale literal baked into the bundle (run-3 F-11.3:
// the old fallback literal drifted from eas.json). Never paste a key
// value into this file.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xkfrsjtfbylhhrvibmxk.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY is not set — set it in eas.json (EAS builds) or .env (local dev, see mobile-app/.env.example).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: { getItem: secureGetItem, setItem: secureSetItem, removeItem: secureRemoveItem },
    autoRefreshToken: true,
    persistSession: true,
    // Web needs this so OAuth / magic-link redirects restore the session.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// React Native has no window-focus events for supabase-js to key its
// refresh timer on, so drive it from AppState (Supabase's RN guidance).
// Without this, a backgrounded app's session can lapse unrefreshed and
// the user finds themselves logged out despite persistSession: true.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
