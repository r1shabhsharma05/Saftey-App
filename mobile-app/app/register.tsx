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
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { supabase } from '../utils/supabase';
import { showAppDialog } from '../utils/dialog';
import { ensureProfile, friendlyAuthError } from '../utils/auth';
import AuthBackground from '../components/auth/Background';
import AuthBrand from '../components/auth/Brand';
import AuthInput from '../components/auth/Input';
import AuthButton from '../components/auth/Button';
import SocialButton, { OrDivider } from '../components/auth/SocialButton';
import { signInWithGoogle } from '../utils/googleAuth';
import { AuthTheme } from '../constants/auth-theme';

/**
 * Register — Floxly reference screen 3, adapted for SafeLife AI:
 * "Create an Account", social row, guardian detail fields,
 * gradient Continue CTA. Handles email-verification flow properly.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    // In-flight guard: rapid taps used to stack multiple auth browser
    // sessions on top of each other.
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        showAppDialog('Google Sign-Up Unavailable', error);
      }
      // On success the root layout's auth listener navigates to the tabs.
    } catch (e: any) {
      showAppDialog('Google Sign-Up Unavailable', friendlyAuthError(e));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleRegister = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanFirst = firstName.trim();
    const cleanPhone = phone.trim();

    if (!cleanFirst || !cleanEmail || !password || !cleanPhone) {
      showAppDialog(
        'Missing Details',
        'Please fill in your name, phone, email and password.'
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showAppDialog('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (!/^[a-zA-Z\s]+$/.test(cleanFirst)) {
      showAppDialog('Invalid Name', 'Name can only contain letters and spaces.');
      return;
    }
    if (cleanPhone.replace(/\D/g, '').length < 10) {
      showAppDialog('Invalid Phone', 'Please enter a valid phone number (min 10 digits).');
      return;
    }
    if (password.length < 6) {
      showAppDialog('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            first_name: cleanFirst,
            last_name: lastName.trim(),
            phone: cleanPhone,
          },
        },
      });

      if (error) {
        showAppDialog('Sign Up Failed', friendlyAuthError(error));
        return;
      }

      if (data.session && data.user) {
        // No email confirmation required — create profile and enter.
        await ensureProfile(data.user);
        router.replace('/(tabs)');
      } else if (data.user) {
        // Email confirmation required — guide to inbox.
        router.push({
          pathname: '/verify-email',
          params: { email: cleanEmail },
        });
      } else {
        // No error, no user, no session: never fail silently.
        showAppDialog('Sign Up Incomplete', 'Sign-up did not finish. Please try again.');
      }
    } catch (e: any) {
      showAppDialog('Sign Up Failed', friendlyAuthError(e));
    } finally {
      setLoading(false);
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
            <AuthBrand compact />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(100).duration(500)}>
            <Text style={styles.headline}>Create an Account</Text>
            <Text style={styles.sub}>
              Join the guardian network — verify your email and set a password.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(180).duration(500)} style={styles.socialRow}>
            <SocialButton provider="google" onPress={handleGoogle} />
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(240).duration(500)}>
            <OrDivider />

            <View style={styles.row}>
              <View style={styles.half}>
                <AuthInput
                  icon="account-outline"
                  placeholder="First name"
                  value={firstName}
                  onChangeText={setFirstName}
                />
              </View>
              <View style={styles.half}>
                <AuthInput
                  icon="account-outline"
                  placeholder="Last name"
                  value={lastName}
                  onChangeText={setLastName}
                />
              </View>
            </View>

            <AuthInput
              icon="phone-outline"
              placeholder="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              containerStyle={styles.fieldGap}
            />
            <AuthInput
              icon="email-outline"
              placeholder="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              containerStyle={styles.fieldGap}
            />
            <AuthInput
              icon="lock-outline"
              placeholder="Set a password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              containerStyle={styles.fieldGap}
            />

            <AuthButton
              title="Continue"
              onPress={handleRegister}
              loading={loading}
              style={styles.cta}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Have an account? </Text>
              <Pressable onPress={() => router.push('/login')} hitSlop={8}>
                <Text style={styles.switchLink}>Log In</Text>
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
    paddingTop: 64,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  brand: { alignItems: 'center', marginBottom: 26 },
  headline: {
    color: AuthTheme.colors.heading,
    fontFamily: AuthTheme.fonts.headline,
    fontSize: 30,
    textAlign: 'center',
  },
  sub: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 19,
  },
  socialRow: { flexDirection: 'row' },
  socialGap: { width: 14 },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  fieldGap: { marginTop: 14 },
  cta: { marginTop: 24, marginBottom: 20 },
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
