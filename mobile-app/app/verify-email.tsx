import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { resendConfirmation } from '../utils/auth';
import AuthBackground from '../components/auth/Background';
import AuthBrand from '../components/auth/Brand';
import AuthButton from '../components/auth/Button';
import { AuthTheme } from '../constants/auth-theme';

/**
 * Shown after signup when Supabase requires email confirmation.
 * Guides the user to their inbox with a resend option.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [sending, setSending] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setSending(true);
    await resendConfirmation(email);
    setSending(false);
  };

  return (
    <AuthBackground>
      <View style={styles.root}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.brand}>
          <AuthBrand compact />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(120).duration(500)} style={styles.card}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="email-check-outline" size={52} color="#fff" />
          </View>
          <Text style={styles.headline}>Check Your Inbox</Text>
          <Text style={styles.sub}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.email}>{email || 'your email address'}</Text>
            {'\n'}Tap the link to activate your guardian account.
          </Text>

          <AuthButton
            title="Resend Link"
            onPress={handleResend}
            loading={sending}
            style={styles.cta}
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Verified already? </Text>
            <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
              <Text style={styles.switchLink}>Log In</Text>
            </Pressable>
          </View>
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
  email: { color: '#fff', fontFamily: AuthTheme.fonts.bodyBold },
  cta: { width: '100%', marginTop: 30, marginBottom: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchText: { color: AuthTheme.colors.subtext, fontFamily: AuthTheme.fonts.body, fontSize: 14 },
  switchLink: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.bodyBold,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
