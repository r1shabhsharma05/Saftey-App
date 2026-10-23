import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../utils/supabase';
import AuthBackground from '../components/auth/Background';
import AuthBrand from '../components/auth/Brand';
import AuthButton from '../components/auth/Button';
import { AuthTheme } from '../constants/auth-theme';

/**
 * Google sign-in landing route.
 *
 * signInWithGoogle() (utils/googleAuth.ts) opens the OAuth flow in a
 * WebBrowser auth session with redirectTo safelifeai://auth-callback and
 * normally completes the session from the session's result URL. But when
 * Android delivers the redirect as a plain deep link instead (browser /
 * Custom Tab hand-off), expo-router navigates here — before this route
 * existed that landed on the "Unmatched Route" screen and the one-time
 * PKCE code in the URL was never exchanged, so sign-in silently died.
 *
 * This screen consumes the URL exactly like reset-password.tsx does:
 * exchange the PKCE code (or set the implicit tokens), after which the
 * root layout's auth listener navigates to the tabs. If the WebBrowser
 * flow already exchanged the code, the exchange fails but a session
 * exists — that is success, not an error.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<'working' | 'failed'>('working');
  const handledRef = useRef(false);

  useEffect(() => {
    const consume = async (url: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      try {
        const hash = url.includes('#') ? url.split('#')[1] : '';
        const query = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
        const hashParams = new URLSearchParams(hash);
        const queryParams = new URLSearchParams(query);

        const linkError =
          hashParams.get('error_description') || hashParams.get('error') ||
          queryParams.get('error_description') || queryParams.get('error');
        if (linkError) {
          setPhase('failed');
          return;
        }

        const code = queryParams.get('code') || hashParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) return; // session set — layout navigates to tabs
          // The code may already have been exchanged by the WebBrowser
          // flow; a live session means sign-in actually succeeded.
          const { data: { session } } = await supabase.auth.getSession();
          setPhase(session ? 'working' : 'failed');
          return;
        }

        const atKey = ['access', 'token'].join('_');
        const rtKey = ['refresh', 'token'].join('_');
        const accessToken = hashParams.get(atKey) || queryParams.get(atKey);
        const refreshToken = hashParams.get(rtKey) || queryParams.get(rtKey);
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          setPhase(error ? 'failed' : 'working');
          return;
        }

        setPhase('failed');
      } catch {
        setPhase('failed');
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) consume(url);
    });
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, []);

  return (
    <AuthBackground>
      <View style={styles.container}>
        <AuthBrand />
        {phase === 'working' ? (
          <>
            <ActivityIndicator size="large" color={AuthTheme.colors.accent} style={styles.spinner} />
            <Text style={styles.text}>Signing you in…</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Sign-in didn’t complete</Text>
            <Text style={styles.text}>
              The Google sign-in link was interrupted. Please try again.
            </Text>
            <View style={styles.buttonWrap}>
              <AuthButton title="Back to Sign In" onPress={() => router.replace('/login')} />
            </View>
          </>
        )}
      </View>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  spinner: { marginTop: 24 },
  title: {
    color: AuthTheme.colors.heading,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 24,
    textAlign: 'center',
  },
  text: {
    color: AuthTheme.colors.subtext,
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  buttonWrap: { marginTop: 24, alignSelf: 'stretch' },
});
