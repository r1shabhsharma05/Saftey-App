import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import * as SplashScreen from 'expo-splash-screen';
import { 
  useFonts, 
  SpaceGrotesk_300Light, 
  SpaceGrotesk_400Regular, 
  SpaceGrotesk_500Medium, 
  SpaceGrotesk_600SemiBold, 
  SpaceGrotesk_700Bold 
} from '@expo-google-fonts/space-grotesk';
import { 
  Manrope_300Light, 
  Manrope_400Regular, 
  Manrope_500Medium, 
  Manrope_600SemiBold, 
  Manrope_700Bold, 
  Manrope_800ExtraBold 
} from '@expo-google-fonts/manrope';
import 'react-native-reanimated';
import { Theme } from '../constants/theme';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

const CustomDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Theme.colors.surface,
    primary: Theme.colors.primary,
    card: Theme.colors.surfaceContainer,
    text: Theme.colors.onSurface,
    border: Theme.colors.outlineVariant,
  },
};

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);

  const [fontsLoaded] = useFonts({
    SpaceGrotesk_300Light,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_300Light,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitialized(true);
    });

    // Listen for auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setInitialized(true);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!initialized || !fontsLoaded) return;

    const inTabsGroup = segments[0] === '(tabs)';

    if (!session && inTabsGroup) {
      router.replace('/register');
    } else if (session && !inTabsGroup) {
      router.replace('/(tabs)');
    }
  }, [session, initialized, segments, fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? CustomDarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
