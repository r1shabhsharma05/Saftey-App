import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Custom storage adapter for SSR safety (Expo Web)
const customStorage = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(key);
      }
      return null;
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } else {
      await AsyncStorage.setItem(key, value);
    }
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
      }
    } else {
      await AsyncStorage.removeItem(key);
    }
  },
};

// 🚀 SUPABASE CONFIGURATION
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xkfrsjtfbylhhrvibmxk.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZnJzanRmYnlsaGhydmlibXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzODcwNDksImV4cCI6MjEwNzk2MzA0OX0.ypd-j8LROeCjqcTloC2qhUw73gJZA_Hd7fn6KtJSYPE';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    // Web needs this so OAuth / magic-link redirects restore the session.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
