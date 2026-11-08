import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { secureGetItem, secureSetItem, secureRemoveItem } from './secureStorage';

// (M2) The session lives in the OS keychain/keystore via
// expo-secure-store, not plaintext AsyncStorage: the stored tokens
// are what an attacker needs to impersonate the user. Web has no
// keychain, so it keeps AsyncStorage (same exposure as before). A
// pre-M2 session still in AsyncStorage is migrated once on first
// read (see secureStorage.ts) — no user is logged out by the move.

// 🚀 SUPABASE CONFIGURATION
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xkfrsjtfbylhhrvibmxk.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZnJzanRmYnlsaGhydmlibXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzODcwNDksImV4cCI6MjEwNzk2MzA0OX0.ypd-j8LROeCjqcTloC2qhUw73gJZA_Hd7fn6KtJSYPE';

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
