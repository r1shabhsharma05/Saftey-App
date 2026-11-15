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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../utils/supabase';
import { showAppDialog } from '../utils/dialog';
import { ensureProfile, friendlyAuthError, resendConfirmation } from '../utils/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { checkLoginPrecheck, requestForgotPassword, requestLoginCode, submitProfileDob, verifyLoginCode } from '../utils/phoneAuth';
import { validateDateOfBirth } from '../utils/dob';
import { DEFAULT_COUNTRY, nationalDigitsValid, toE164, type CountryOption } from '../utils/phone';
import { PRIVACY_URL, TERMS_URL } from '../constants/legal';
import GlobeWireframe from '../components/GlobeWireframe';
import OtpCubes, { type OtpPhase } from '../components/OtpCubes';
import AuthInput from '../components/auth/Input';
import AuthButton from '../components/auth/Button';
import CountryPicker from '../components/auth/CountryPicker';
import SocialButton, { OrDivider } from '../components/auth/SocialButton';
import { signInWithGoogle } from '../utils/googleAuth';
import TurnstileWidget from '../components/TurnstileWidget';
import { AuthTheme } from '../constants/auth-theme';

const BACKEND_URL = getBackendUrl();

/**
 * Login — the landing page's globe auth design, in the app:
 * black background, rotating wireframe globe hero, dark card with
 * the Sign in / Create account toggle, white Google button, and
 * the white submit button.
 *
 * Login is by MOBILE NUMBER + password, with an SMS code step.
 * Supabase auth is email-based, so the phone is verified by OTP
 * first (POST /auth/login/request-code → verify-code, which returns
 * the account email) and then signInWithPassword runs. There is no
 * phone-to-email resolve endpoint anymore: resolving a phone to an
 * email for an unauthenticated caller leaked account existence.
 */
export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [country, setCountry] = useState<CountryOption>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // H15 age gate for Google sign-in (mirror of register.tsx):
  // pre-gate Google accounts never passed signup/complete's DOB
  // check. The DOB field below only appears when a Google sign-in
  // lands without a DOB on record — the user enters it, then taps
  // Google again. Phone-OTP sign-in is untouched.
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [googleDobNeeded, setGoogleDobNeeded] = useState(false);

  // OTP stage: the digits live inside OtpCubes; the parent only
  // holds the phase, the same way register.tsx wires it.
  const [stage, setStage] = useState<'form' | 'otp'>('form');
  const [otpPhase, setOtpPhase] = useState<OtpPhase>('idle');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpNonce, setOtpNonce] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);

  // Turnstile bot-check token (6.3): solved by the widget below on
  // the form stage; passed to the OTP request-code calls. Null when
  // the widget is unconfigured or the token expired — the calls then
  // proceed token-less and the server decides.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // Step 1: SMS the code to the number. The password stays typed —
  // step 2 signs in with it once the code verifies.
  const handleLogin = async () => {
    const cleanPhone = phone.trim();
    if (!cleanPhone || !password) {
      showAppDialog('Missing Details', 'Please enter your mobile number and password.');
      return;
    }
    if (!nationalDigitsValid(country.dial, cleanPhone)) {
      showAppDialog(
        'Invalid Phone',
        country.dial === '+91'
          ? 'Please enter a valid 10-digit Indian mobile number.'
          : 'Please enter a valid mobile number for the selected country.'
      );
      return;
    }

    setLoading(true);
    try {
      const res = await requestLoginCode(BACKEND_URL, toE164(country.dial, cleanPhone), turnstileToken ?? undefined);
      if (!res.reached) {
        showAppDialog(
          'No Connection',
          res.failure === 'timeout'
            ? 'The request timed out — the SafeLife servers took too long to answer. Check your connection and try again.'
            : 'Could not reach the SafeLife servers. Check your internet and try again.'
        );
        return;
      }
      if (!res.success) {
        showAppDialog(
          'Code Not Sent',
          res.reason === 'channel-not-configured'
            ? 'SMS is not configured yet. Please try again later.'
            : res.error || 'The code could not be sent. Please try again.'
        );
        return;
      }
      setOtpPhase('idle');
      setOtpError(null);
      setStage('otp');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: verify the code, take the returned email, sign in.
  const handleCodeComplete = async (submitted: string) => {
    if (!/^\d{6}$/.test(submitted)) return;
    setOtpPhase('verifying');
    setOtpError(null);
    setOtpBusy(true);
    try {
      const res = await verifyLoginCode(BACKEND_URL, toE164(country.dial, phone.trim()), submitted);
      if (!res.reached) {
        showAppDialog(
          'No Connection',
          res.failure === 'timeout'
            ? 'The request timed out — the SafeLife servers took too long to answer. Your code may still be unused; try again.'
            : 'Could not reach the SafeLife servers. Check your internet and try again.'
        );
        setOtpPhase('idle');
        setOtpNonce((n) => n + 1);
        return;
      }
      if (!res.success || !res.email) {
        setOtpError(res.error || 'That code isn’t right. Please try again.');
        setOtpPhase('error');
        return;
      }
      setOtpPhase('success');
      // (2.4) Per-email login-attempt precheck BEFORE sign-in: the
      // backend 429s when this email has had too many attempts. On
      // 429 do NOT attempt sign-in. On network error to the precheck
      // (reached:false) proceed — fail-open for availability, since
      // Supabase still enforces its own server-side limits.
      const precheck = await checkLoginPrecheck(BACKEND_URL, res.email);
      if (!precheck.allowed) {
        showAppDialog(
          'Too Many Attempts',
          precheck.retryAfterSeconds
            ? `Too many login attempts for this account. Try again in ${precheck.retryAfterSeconds} seconds.`
            : 'Too many login attempts for this account. Try again later.'
        );
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: res.email,
        password,
      });
      if (error) {
        if (/email not confirmed/i.test(error.message)) {
          showAppDialog(
            'Verify Your Email',
            'Your account is created but not verified yet. Check your inbox for the confirmation link.',
            [
              { text: 'Resend Link', onPress: () => resendConfirmation(res.email!) },
              { text: 'OK', style: 'cancel' },
            ]
          );
          setStage('form');
          setOtpPhase('idle');
          return;
        }
        showAppDialog('Login Failed', friendlyAuthError(error));
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      if (data.session && data.user) {
        await ensureProfile(data.user);
        router.replace('/(tabs)');
      } else {
        // No error but no session either: never fail silently.
        showAppDialog('Sign-In Incomplete', 'Sign-in did not finish. Please try again.');
        setStage('form');
        setOtpPhase('idle');
      }
    } catch (e: any) {
      showAppDialog('Login Failed', friendlyAuthError(e));
      setStage('form');
      setOtpPhase('idle');
    } finally {
      setOtpBusy(false);
    }
  };

  // OtpCubes calls this after its error animation played out: the
  // cubes spring back, the boxes clear, entry starts over.
  const handleOtpReset = () => {
    setOtpPhase('idle');
    setOtpError(null);
    setOtpNonce((n) => n + 1);
  };

  const handleResend = async () => {
    setOtpBusy(true);
    try {
      const res = await requestLoginCode(BACKEND_URL, toE164(country.dial, phone.trim()), turnstileToken ?? undefined);
      if (!res.reached || !res.success) {
        showAppDialog(
          'Code Not Sent',
          res.reason === 'channel-not-configured'
            ? 'SMS is not configured yet. Please try again later.'
            : res.error || 'The code could not be sent. Please try again.'
        );
      }
    } finally {
      setOtpBusy(false);
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
        return;
      }
      // H15 age gate for Google sign-in, mirroring register.tsx's
      // handleGoogle: OAuth creates the Supabase session directly,
      // so signup/complete's DOB check never ran for pre-gate
      // Google accounts. Check the DOB on record BEFORE the session
      // is allowed to proceed into the tabs.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return; // user cancelled — no session, nothing to gate
      const metaDob = (user.user_metadata as Record<string, unknown> | undefined)?.date_of_birth;
      if (typeof metaDob === 'string' && validateDateOfBirth(metaDob).ok) {
        // DOB already on record — skip the prompt and the POST.
        await ensureProfile(user);
        return;
      }
      // No DOB on record: the DOB field revealed below is the prompt
      // (same input + validation as register.tsx). Nothing is
      // completed until a valid DOB is posted to /auth/profile/dob.
      const dob = validateDateOfBirth(dateOfBirth);
      if (!dob.ok) {
        // Fail closed: drop the fresh Google session so the root
        // layout's auth listener cannot carry an under-gated account
        // into the tabs, reveal the DOB field, and tell the user to
        // enter a DOB and tap Google again.
        await supabase.auth.signOut();
        setGoogleDobNeeded(true);
        showAppDialog(
          'Date of Birth Required',
          'Google sign-in needs your date of birth — you must be at least 13. Please enter it in the date of birth field below, then tap Continue with Google again.'
        );
        return;
      }
      const posted = await submitProfileDob(BACKEND_URL, dob.iso);
      if (!posted.reached || !posted.success) {
        // Fail closed: no DOB on record → no entry into the app.
        await supabase.auth.signOut();
        showAppDialog(
          'Sign-In Incomplete',
          posted.reached
            ? posted.error || 'Your date of birth could not be saved. Please try signing in again.'
            : 'Could not reach the SafeLife servers. Please check your internet and try signing in again.'
        );
        return;
      }
      await ensureProfile(user);
      // On success the root layout's auth listener navigates to the tabs.
    } catch (e: any) {
      showAppDialog('Google Sign-In Unavailable', friendlyAuthError(e));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleForgotPassword = () => {
    // One generic message regardless of whether the number has an
    // account — the old flow resolved the phone first and told the
    // caller 'No account found' (2.3).
    showAppDialog(
      'Reset Password',
      "Enter your mobile number above, then tap OK and we'll send a reset link if an account exists for it.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'OK',
          onPress: async () => {
            if (!phone.trim() || !nationalDigitsValid(country.dial, phone.trim())) {
              showAppDialog('Invalid Phone', 'Please enter a valid mobile number first.');
              return;
            }
            const res = await requestForgotPassword(
              BACKEND_URL,
              toE164(country.dial, phone.trim()),
              turnstileToken ?? undefined
            );
            showAppDialog(
              res.reached ? 'Email Sent' : 'No Connection',
              res.reached
                ? 'If an account exists for this number, a reset link was sent.'
                : 'Could not reach the SafeLife servers. Check your internet and try again.'
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
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
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

            {googleDobNeeded && (
              <>
                <AuthInput
                  icon="calendar-outline"
                  placeholder="Date of birth (YYYY-MM-DD)"
                  value={dateOfBirth}
                  onChangeText={setDateOfBirth}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  containerStyle={styles.fieldGap}
                />
                <Text style={styles.dobHint}>You must be at least 13 years old to use SafeLife.</Text>
              </>
            )}

            <OrDivider label="or continue with mobile" />

            {stage === 'form' ? (
              <>
                <View style={styles.phoneRow}>
                  <CountryPicker value={country} onChange={setCountry} />
                  <View style={styles.phoneInput}>
                    <AuthInput
                      icon="phone-outline"
                      placeholder="Mobile number"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>
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

                <TurnstileWidget onToken={setTurnstileToken} />

                <AuthButton
                  title="Send Code"
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
              </>
            ) : (
              <>
                <Text style={styles.otpTitle}>Verify your number</Text>
                <Text style={styles.otpSub}>
                  We sent a 6-digit code to {toE164(country.dial, phone.trim())}. Enter it below — it expires in 10
                  minutes.
                </Text>
                <OtpCubes
                  phone={toE164(country.dial, phone.trim())}
                  phase={otpPhase}
                  errorMessage={otpError}
                  busy={otpBusy}
                  resetNonce={otpNonce}
                  onCodeComplete={handleCodeComplete}
                  onResend={handleResend}
                  onReset={handleOtpReset}
                />
                {otpPhase === 'success' && (
                  <Text style={styles.otpSuccess}>Number verified — signing you in…</Text>
                )}
                <Pressable
                  onPress={() => {
                    setStage('form');
                    setOtpPhase('idle');
                    setOtpError(null);
                  }}
                  hitSlop={8}
                  style={styles.changeNumber}
                >
                  <Text style={styles.changeNumberText}>Change number</Text>
                </Pressable>
              </>
            )}
          </Animated.View>

          <View style={styles.termsRow}>
            <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={8}>
              <Text style={styles.termsLink}>Terms of Service</Text>
            </Pressable>
            <Text style={styles.termsSep}> | </Text>
            <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} hitSlop={8}>
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Pressable>
          </View>
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
  dobHint: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 12,
    marginTop: 6,
  },
  phoneRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  phoneInput: { flex: 1 },
  otpTitle: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.headline,
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  otpSub: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 8,
  },
  otpSuccess: {
    color: '#2dd4a0',
    fontFamily: AuthTheme.fonts.body,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  changeNumber: { alignItems: 'center', marginTop: 16 },
  changeNumberText: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.body,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
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
  termsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  termsLink: {
    color: AuthTheme.colors.faint,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  termsSep: {
    color: AuthTheme.colors.faint,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 12,
  },
});
