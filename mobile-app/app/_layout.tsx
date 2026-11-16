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
import { checkForceUpdate } from '../utils/forceUpdate';
import ForceUpdateScreen from '../components/ForceUpdateScreen';
import { validateDateOfBirth } from '../utils/dob';
import { getBackendUrl } from '../utils/backendUrl';
import { isDobBackfillInProgress } from '../utils/dobGate';

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
  // H18 force-update gate: true = this build is below the backend's
  // minSupportedVersion — the blocking notice covers the whole app.
  const [updateRequired, setUpdateRequired] = useState(false);
  const [minVersion, setMinVersion] = useState<string | undefined>(undefined);
  const [latestVersion, setLatestVersion] = useState<string | undefined>(undefined);
  // H15 age gate: true while a signed-in session was found without a
  // valid (13+) DOB on record. While set, routing stays on /login
  // (the DOB prompt lives there) and never bounces to /onboarding
  // or the tabs — signOut() fires the auth listener, which would
  // otherwise route a session-less user in tabs to /onboarding.

  // H18: check GET /version once on launch. Fail-open — a check
  // that cannot reach the server (or a missing backend URL) never
  // blocks the app; only a positive below-min answer sets the gate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await checkForceUpdate(getBackendUrl());
        if (!cancelled && result.updateRequired) {
          setMinVersion(result.minSupportedVersion);
          setLatestVersion(result.latestVersion);
          setUpdateRequired(true);
        }
      } catch {
        /* version check is best-effort — fail open */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const [dobBlocked, setDobBlocked] = useState(false);

  useEffect(() => {
    if (!initialized || (!fontsLoaded && !fontError)) return;

    const inTabsGroup = segments[0] === '(tabs)';
    const inAuthGroup = ['login', 'register', 'onboarding', 'reset-password', 'auth-callback'].includes(
      segments[0] as string
    );

    // H15 age gate — runs AFTER the force-update gate: while an
    // update is required the blocking screen covers the app and
    // this gate waits (updateRequired is in the dep list, so the
    // effect re-runs once the gate clears — it cannot clear without
    // an app update, so in practice the DOB check runs on a build
    // that is not force-blocked).
    if (updateRequired) return;

    // A session that was already DOB-blocked: stay on the DOB
    // prompt (/login) until a fresh, gated sign-in lands. The
    // signOut() below fires the auth listener (session → null);
    // without this branch that would bounce the user to /onboarding.
    // Clears the moment a session WITH a valid DOB appears, so a
    // user who just completed the prompt is routed to the tabs.
    if (dobBlocked) {
      const metaDob = (session?.user?.user_metadata as Record<string, unknown> | undefined)
        ?.date_of_birth;
      if (session && typeof metaDob === 'string' && validateDateOfBirth(metaDob).ok) {
        setDobBlocked(false);
      } else {
        if (segments[0] !== 'login') router.replace('/login');
        return;
      }
    }

    if (session && segments[0] !== 'reset-password') {
      // reset-password is exempt, same as the routing below: a
      // recovery link creates a session BEFORE the new password is
      // typed, and signing it out here would make reset impossible.
      // DOB lives in user_metadata.date_of_birth only — never in
      // profiles. A missing/invalid value means a pre-gate account
      // (Google OAuth bypassed signup/complete's DOB check).
      const metaDob = (session.user?.user_metadata as Record<string, unknown> | undefined)
        ?.date_of_birth;
      if (typeof metaDob !== 'string' || !validateDateOfBirth(metaDob).ok) {
        // H15 race guard (utils/dobGate.ts): login.tsx / register.tsx
        // is mid-backfill — the DOB POST + session refresh are in
        // flight and the local JWT is stale, not the account.
        // Defer: do NOT sign out here, that would kill the session
        // the POST authenticates with. The refresh re-fires this
        // effect with the fresh JWT; if the backfill fails,
        // login.tsx signs out itself, fail-closed.
        if (isDobBackfillInProgress()) return;
        // Fail closed: drop the session so no route can carry an
        // under-gated account into the tabs, and send the user to
        // the DOB prompt on /login (same field + POST /auth/profile/dob
        // flow as login.tsx's Google handler).
        setDobBlocked(true);
        void supabase.auth.signOut();
        if (segments[0] !== 'login') router.replace('/login');
        return;
      }
    }

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
  }, [session, initialized, segments, fontsLoaded, fontError, updateRequired, dobBlocked]);

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
      {updateRequired ? (
        <ForceUpdateScreen minSupportedVersion={minVersion} latestVersion={latestVersion} />
      ) : null}
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
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0c0c1d',
    zIndex: 50,
  },
  introFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
