import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../utils/supabase';
import { showAppDialog } from '../utils/dialog';
import { ensureProfile, friendlyAuthError, resendConfirmation } from '../utils/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { resolveLoginEmail } from '../utils/phoneAuth';
import GlobeWireframe from '../components/GlobeWireframe';
import AuthInput from '../components/auth/Input';
import AuthButton from '../components/auth/Button';
import SocialButton, { OrDivider } from '../components/auth/SocialButton';
import { signInWithGoogle } from '../utils/googleAuth';
import { AuthTheme } from '../constants/auth-theme';

const BACKEND_URL = getBackendUrl();

/**
 * Login — the landing page's globe auth design, in the app:
 * black background, rotating wireframe globe hero, dark card with
 * the Sign in / Create account toggle, white Google button, and
 * the white submit button.
 *
 * Login is by MOBILE NUMBER + password. Supabase auth is
 * email-based, so the phone is resolved to the account email first
 * (POST /auth/login/resolve) and then signInWithPassword runs.
 */
export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleLogin = async () => {
    const cleanPhone = phone.trim();
    if (!cleanPhone || !password) {
      showAppDialog('Missing Details', 'Please enter your mobile number and password.');
      return;
    }
    if (cleanPhone.replace(/\D/g, '').length < 10) {
      showAppDialog('Invalid Phone', 'Please enter a valid mobile number (min 10 digits).');
      return;
    }

    setLoading(true);
    try {
      const resolved = await resolveLoginEmail(BACKEND_URL, cleanPhone);
      if (!resolved.reached) {
        showAppDialog(
          'No Connection',
          'Could not reach the SafeLife servers. Check your internet and try again.'
        );
        return;
      }
      if (!resolved.success || !resolved.email) {
        showAppDialog('Login Failed', resolved.error || 'No account found for this mobile number.');
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: resolved.email,
        password,
      });

      if (error) {
        if (/email not confirmed/i.test(error.message)) {
          showAppDialog(
            'Verify Your Email',
            'Your account is created but not verified yet. Check your inbox for the confirmation link.',
            [
              { text: 'Resend Link', onPress: () => resendConfirmation(resolved.email!) },
              { text: 'OK', style: 'cancel' },
            ]
          );
          return;
        }
        showAppDialog('Login Failed', friendlyAuthError(error));
        return;
      }

      if (data.session && data.user) {
        await ensureProfile(data.user);
        router.replace('/(tabs)');
      } else {
        // No error but no session either: never fail silently.
        showAppDialog('Sign-In Incomplete', 'Sign-in did not finish. Please try again.');
      }
    } catch (e: any) {
      showAppDialog('Login Failed', friendlyAuthError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    // In-flight guard: rapid taps used to stack multiple auth browser
    // sessions on top of each other.
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        showAppDialog('Google Sign-In Unavailable', error);
      }
      // On success the root layout's auth listener navigates to the tabs.
    } catch (e: any) {
      showAppDialog('Google Sign-In Unavailable', friendlyAuthError(e));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleForgotPassword = () => {
    showAppDialog(
      'Reset Password',
      "Enter your mobile number above, then tap OK and we'll send a reset link to the email on your account.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: async () => {
            if (!phone.trim()) return;
            const resolved = await resolveLoginEmail(BACKEND_URL, phone.trim());
            if (!resolved.reached || !resolved.success || !resolved.email) {
              showAppDialog(
                'Reset Failed',
                resolved.error || 'No account found for this mobile number.'
              );
              return;
            }
            // redirectTo matters: without it the email link dead-ends
            // on the Supabase site URL. It opens the app's reset
            // screen instead (the URL must also be allow-listed in
            // the Supabase dashboard under Auth → URL Configuration).
            const { error } = await supabase.auth.resetPasswordForEmail(resolved.email, {
              redirectTo: Linking.createURL('reset-password'),
            });
            showAppDialog(
              error ? 'Reset Failed' : 'Email Sent',
              error
                ? friendlyAuthError(error)
                : 'Check your inbox for the password reset link.'
            );
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeIn.duration(500)} style={styles.hero}>
            <GlobeWireframe size={200} />
            <LinearGradient colors={['transparent', '#000000']} style={styles.heroFade} />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(100).duration(500)}>
            <Text style={styles.headline}>Welcome back</Text>
            <Text style={styles.sub}>Log in to your guardian network.</Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(180).duration(500)} style={styles.card}>
            <View style={styles.toggleRow}>
              <Pressable style={[styles.toggleBtn, styles.toggleActive]} hitSlop={6}>
                <Text style={styles.toggleActiveText}>Sign in</Text>
              </Pressable>
              <Pressable
                style={styles.toggleBtn}
                onPress={() => router.push('/register')}
                hitSlop={6}
              >
                <Text style={styles.toggleText}>Create account</Text>
              </Pressable>
            </View>

            <SocialButton provider="google" onPress={handleGoogle} variant="light" />

            <OrDivider label="or continue with mobile" />

            <AuthInput
              icon="phone-outline"
              placeholder="Mobile number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <AuthInput
              icon="lock-outline"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              secureToggle
              containerStyle={styles.fieldGap}
            />
            <Pressable onPress={handleForgotPassword} hitSlop={10}>
              <Text style={styles.forgot}>Forgot Password?</Text>
            </Pressable>

            <AuthButton
              title="Log In"
              onPress={handleLogin}
              loading={loading}
              variant="white"
              style={styles.cta}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Don&apos;t have an account? </Text>
              <Pressable onPress={() => router.push('/register')} hitSlop={8}>
                <Text style={styles.switchLink}>Sign Up</Text>
              </Pressable>
            </View>
          </Animated.View>

          <Text style={styles.terms}>Terms of Service | Privacy Policy</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', height: 208, marginBottom: 8 },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
  },
  headline: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.headline,
    fontSize: 28,
    textAlign: 'center',
  },
  sub: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  card: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 24,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    borderRadius: 999,
    padding: 4,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: '#fff' },
  toggleText: { color: '#a1a1aa', fontFamily: AuthTheme.fonts.label, fontSize: 14 },
  toggleActiveText: { color: '#000', fontFamily: AuthTheme.fonts.label, fontSize: 14 },
  fieldGap: { marginTop: 14 },
  forgot: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.label,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 14,
    marginBottom: 22,
  },
  cta: { marginBottom: 22 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText: { color: AuthTheme.colors.subtext, fontFamily: AuthTheme.fonts.body, fontSize: 14 },
  switchLink: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.bodyBold,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  terms: {
    color: AuthTheme.colors.faint,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 28,
    textDecorationLine: 'underline',
  },
});
