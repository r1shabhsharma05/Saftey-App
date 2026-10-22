import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Reanimated, { FadeOut } from 'react-native-reanimated';
import { supabase } from '../utils/supabase';
import AnimatedLogo from '../components/AnimatedLogo';
import AppDialogHost from '../components/ui/AppDialog';
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
  const [introVisible, setIntroVisible] = useState(true);

  const [fontsLoaded, fontError] = useFonts({
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
    // fontError counts as "ready" too: a failed font load used to
    // wedge the app on a blank screen forever (the tree below returned
    // null until fontsLoaded). Fall back to system fonts instead.
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    // Check initial session — with a catch: a rejected getSession()
    // used to leave `initialized` false forever and the app hung.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitialized(true);
    }).catch(() => {
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
    if (!initialized || (!fontsLoaded && !fontError)) return;

    const inTabsGroup = segments[0] === '(tabs)';
    const inAuthGroup = ['login', 'register', 'onboarding', 'verify-email', 'reset-password'].includes(
      segments[0] as string
    );

    if (!session && inTabsGroup) {
      router.replace('/onboarding');
    } else if (session && !inTabsGroup && segments[0] !== 'reset-password') {
      // reset-password is exempt: a recovery link creates a session
      // BEFORE the user has typed the new password — bouncing to the
      // tabs here would make password reset impossible.
      router.replace('/(tabs)');
    } else if (!session && !inTabsGroup && !inAuthGroup) {
      router.replace('/onboarding');
    }
  }, [session, initialized, segments, fontsLoaded, fontError]);

  // Animated app-open intro. The native splash is static by platform
  // design, so the moment the app is actually ready this overlay takes
  // over with the animated logo, plays briefly, and fades — the open
  // feels designed and fast instead of "default splash, then app".
  // It never delays readiness (same gate as the tree below) and a tap
  // skips it once ready.
  const appReady = initialized && (fontsLoaded || !!fontError);
  useEffect(() => {
    if (!appReady || !introVisible) return;
    const t = setTimeout(() => setIntroVisible(false), 950);
    return () => clearTimeout(t);
  }, [appReady, introVisible]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? CustomDarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="auto" />
      <AppDialogHost />
      {introVisible && (
        <Reanimated.View exiting={FadeOut.duration(320)} style={styles.intro}>
          <Pressable
            style={styles.introFill}
            onPress={() => {
              if (appReady) setIntroVisible(false);
            }}
          >
            <AnimatedLogo />
          </Pressable>
        </Reanimated.View>
      )}
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  intro: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0c0c1d',
    zIndex: 50,
  },
  introFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
