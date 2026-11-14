import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet } from 'react-native';
import Reanimated, { FadeOut } from 'react-native-reanimated';
import { supabase } from '../utils/supabase';
import { authenticateForUnlock, backgroundedForMs, getBiometricCapability, isBiometricLockEnabled, noteBackgrounded, recentlyUnlocked } from '../utils/biometricLock';
import BiometricLockScreen from '../components/BiometricLockScreen';
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
  // Biometric app lock: true = the lock screen covers the tabs.
  const [locked, setLocked] = useState(false);

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

  // Biometric app lock: when a session exists and the preference is
  // on, arm the lock — the prompt runs when the lock screen appears.
  // No hardware / nothing enrolled → never armed, never locks out.
  useEffect(() => {
    if (!initialized || !session) {
      setLocked(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!(await isBiometricLockEnabled())) return;
      if (recentlyUnlocked()) return;
      const { hasHardware, isEnrolled } = await getBiometricCapability();
      if (!cancelled && hasHardware && isEnrolled) setLocked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialized, session]);

  // Re-arm on foreground — but not on the 'active' event that fires
  // when the system biometric prompt itself dismisses (that re-locked
  // the app right after every successful unlock and looped the
  // prompt), and not after a quick switch away (e.g. reading the OTP
  // SMS): only a longer absence re-arms the lock.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        noteBackgrounded();
        return;
      }
      if (state !== 'active' || !session) return;
      if (recentlyUnlocked()) return;
      if (backgroundedForMs() < 30000) return;
      void (async () => {
        if (!(await isBiometricLockEnabled())) return;
        const { hasHardware, isEnrolled } = await getBiometricCapability();
        if (hasHardware && isEnrolled) setLocked(true);
      })();
    });
    return () => sub.remove();
  }, [session]);

  // Auto-prompt once when the lock screen appears. A cancelled
  // attempt stays on the lock screen with its Unlock button — it
  // never loops the prompt and never navigates past the lock.
  useEffect(() => {
    if (!locked) return;
    void (async () => {
      if (await authenticateForUnlock()) setLocked(false);
    })();
  }, [locked]);

  useEffect(() => {
    if (!initialized || (!fontsLoaded && !fontError)) return;

    const inTabsGroup = segments[0] === '(tabs)';
    const inAuthGroup = ['login', 'register', 'onboarding', 'reset-password', 'auth-callback'].includes(
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
      {locked ? (
        <BiometricLockScreen onUnlocked={() => setLocked(false)} />
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      )}
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
