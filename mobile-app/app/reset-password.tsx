import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { showAppDialog } from '../utils/dialog';
import { friendlyAuthError } from '../utils/auth';
import AuthBackground from '../components/auth/Background';
import AuthBrand from '../components/auth/Brand';
import AuthInput from '../components/auth/Input';
import AuthButton from '../components/auth/Button';
import { AuthTheme } from '../constants/auth-theme';

/**
 * Password reset landing screen.
 *
 * "Forgot password" used to be a dead end: resetPasswordForEmail was
 * called with no redirectTo, so the email link resolved to the
 * Supabase site URL and went nowhere. The email now links here
 * (safelifeai://reset-password — the URL must also be allow-listed in
 * the Supabase dashboard under Auth → URL Configuration → Redirect
 * URLs). The link carries a one-time PKCE code (or implicit tokens);
 * exchanging it creates a recovery session, and updateUser sets the
 * new password. The root layout deliberately does NOT bounce this
 * screen to the tabs when that session appears.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
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
          setPhase('invalid');
          return;
        }

        const code = queryParams.get('code') || hashParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          setPhase(error ? 'invalid' : 'ready');
          return;
        }

        const access_token = hashParams.get('access_token') || queryParams.get('access_token');
        const refresh_token = hashParams.get('refresh_token') || queryParams.get('refresh_token');
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          setPhase(error ? 'invalid' : 'ready');
          return;
        }

        setPhase('invalid');
      } catch {
        setPhase('invalid');
      }
    };

    Linking.getInitialURL().then(async (url) => {
      if (url) {
        consume(url);
      } else if (!handledRef.current) {
        // Opened without a link (e.g. from a stale route): a live
        // recovery session is the only other way this screen is valid.
        const { data: { session } } = await supabase.auth.getSession();
        if (!handledRef.current) setPhase(session ? 'ready' : 'invalid');
      }
    });
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, []);

  const handleSave = async () => {
    if (password.length < 6) {
      showAppDialog('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirm) {
      showAppDialog('Passwords Do Not Match', 'Type the same new password in both fields.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showAppDialog('Reset Failed', friendlyAuthError(error));
        return;
      }
      showAppDialog('Password Updated', 'Your new password is set. You are signed in.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (e: any) {
      showAppDialog('Reset Failed', friendlyAuthError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthBackground>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.brand}>
          <AuthBrand compact />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(120).duration(500)} style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="lock-reset" size={52} color="#fff" />
          </View>
          <Text style={styles.headline}>Set New Password</Text>

          {phase === 'checking' && (
            <>
              <Text style={styles.sub}>Verifying your reset link…</Text>
              <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
            </>
          )}

          {phase === 'invalid' && (
            <>
              <Text style={styles.sub}>
                This reset link is invalid or has expired. Request a fresh one from the
                sign-in screen (Forgot Password).
              </Text>
              <AuthButton
                title="Back to Sign In"
                onPress={() => router.replace('/login')}
                style={styles.cta}
              />
            </>
          )}

          {phase === 'ready' && (
            <>
              <Text style={styles.sub}>Choose a new password for your guardian account.</Text>
              <AuthInput
                icon="lock-outline"
                placeholder="New password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCorrect={false}
                containerStyle={styles.field}
              />
              <AuthInput
                icon="lock-check-outline"
                placeholder="Confirm new password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCorrect={false}
                containerStyle={styles.field}
              />
              <AuthButton
                title="Set New Password"
                onPress={handleSave}
                loading={saving}
                style={styles.cta}
              />
              <View style={styles.switchRow}>
                <Text style={styles.switchText}>Remembered it? </Text>
                <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
                  <Text style={styles.switchLink}>Log In</Text>
                </Pressable>
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 30, paddingTop: 80, alignItems: 'center' },
  brand: { marginBottom: 40 },
  card: { width: '100%', alignItems: 'center' },
  iconWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: AuthTheme.colors.pill,
    borderWidth: 1,
    borderColor: AuthTheme.colors.pillBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    shadowColor: '#7cc4ff',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 10,
  },
  headline: {
    color: AuthTheme.colors.heading,
    fontFamily: AuthTheme.fonts.headline,
    fontSize: 30,
    textAlign: 'center',
  },
  sub: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 21,
  },
  field: { width: '100%', marginTop: 18 },
  cta: { width: '100%', marginTop: 26, marginBottom: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchText: { color: AuthTheme.colors.subtext, fontFamily: AuthTheme.fonts.body, fontSize: 14 },
  switchLink: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.bodyBold,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
