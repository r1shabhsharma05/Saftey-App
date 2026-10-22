import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { supabase } from '../utils/supabase';
import { ensureProfile, friendlyAuthError, resendConfirmation } from '../utils/auth';
import AuthBackground from '../components/auth/Background';
import AuthBrand from '../components/auth/Brand';
import AuthInput from '../components/auth/Input';
import AuthButton from '../components/auth/Button';
import SocialButton, { OrDivider } from '../components/auth/SocialButton';
import { signInWithGoogle } from '../utils/googleAuth';
import { AuthTheme } from '../constants/auth-theme';

/**
 * Login — Floxly reference screen 2, adapted for SafeLife AI:
 * centered brand, "Welcome Back!", social row, dark pill inputs,
 * gradient CTA, footer links.
 */
export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleLogin = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      Alert.alert('Missing Details', 'Please enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (/email not confirmed/i.test(error.message)) {
          Alert.alert(
            'Verify Your Email',
            'Your account is created but not verified yet. Check your inbox for the confirmation link.',
            [
              { text: 'Resend Link', onPress: () => resendConfirmation(cleanEmail) },
              { text: 'OK', style: 'cancel' },
            ]
          );
          return;
        }
        Alert.alert('Login Failed', friendlyAuthError(error));
        return;
      }

      if (data.session && data.user) {
        await ensureProfile(data.user);
        router.replace('/(tabs)');
      } else {
        // No error but no session either (e.g. email not yet
        // confirmed): the old code just stopped the spinner silently.
        Alert.alert(
          'Sign-In Incomplete',
          'Sign-in did not finish. If this account is new, verify your email first, then sign in.'
        );
      }
    } catch (e: any) {
      Alert.alert('Login Failed', friendlyAuthError(e));
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
        Alert.alert('Google Sign-In Unavailable', error);
      }
      // On success the root layout's auth listener navigates to the tabs.
    } catch (e: any) {
      Alert.alert('Google Sign-In Unavailable', friendlyAuthError(e));
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <AuthBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeIn.duration(500)} style={styles.brand}>
            <AuthBrand />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(100).duration(500)}>
            <Text style={styles.headline}>Welcome Back!</Text>
            <Text style={styles.sub}>Log in to your guardian network.</Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(180).duration(500)} style={styles.socialRow}>
            <SocialButton provider="google" onPress={handleGoogle} />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(240).duration(500)}>
            <OrDivider />
            <AuthInput
              icon="email-outline"
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <AuthInput
              icon="lock-outline"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              containerStyle={styles.fieldGap}
            />
            <Pressable
              onPress={() =>
                Alert.alert(
                  'Reset Password',
                  'Enter your email above, then tap OK and we\'ll send a reset link.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'OK',
                      onPress: async () => {
                        if (!email.trim()) return;
                        // redirectTo matters: without it the email link
                        // dead-ends on the Supabase site URL. It opens
                        // the app's reset screen instead (the URL must
                        // also be allow-listed in the Supabase dashboard
                        // under Auth → URL Configuration).
                        const { error } = await supabase.auth.resetPasswordForEmail(
                          email.trim().toLowerCase(),
                          { redirectTo: Linking.createURL('reset-password') }
                        );
                        Alert.alert(
                          error ? 'Reset Failed' : 'Email Sent',
                          error
                            ? friendlyAuthError(error)
                            : 'Check your inbox for the password reset link.'
                        );
                      },
                    },
                  ]
                )
              }
              hitSlop={10}
            >
              <Text style={styles.forgot}>Forgot Password?</Text>
            </Pressable>

            <AuthButton
              title="Log In"
              onPress={handleLogin}
              loading={loading}
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
    </AuthBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 30,
    paddingTop: 76,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  brand: { alignItems: 'center', marginBottom: 34 },
  headline: {
    color: AuthTheme.colors.heading,
    fontFamily: AuthTheme.fonts.headline,
    fontSize: 32,
    textAlign: 'center',
  },
  sub: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 26,
  },
  socialRow: { flexDirection: 'row' },
  socialGap: { width: 14 },
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
    marginTop: 34,
    textDecorationLine: 'underline',
  },
});
