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
import { ensureProfile, friendlyAuthError } from '../utils/auth';
import { getBackendUrl } from '../utils/backendUrl';
import { checkLoginPrecheck, completeSignup, requestSignupCode, submitProfileDob, verifySignupCode } from '../utils/phoneAuth';
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
 * Register — the landing page's globe auth design, in the app:
 * black background, rotating wireframe globe hero, dark card with
 * the Sign in / Create account toggle, white Google button, and
 * the white submit button.
 *
 * Signup is phone-OTP verified: the Supabase account is created
 * ONLY after the code sent to the mobile number verifies —
 * request-code → V4 OTP screen → verify (proof token) →
 * signup/complete → signInWithPassword → dashboard. The client
 * never calls supabase.auth.signUp directly: the proof token binds
 * the verified phone to the account creation server-side.
 * Email confirmation is OFF (Supabase mailer_autoconfirm), so
 * signIn returns a session immediately; there is no verify-email
 * step anywhere in this flow.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState<CountryOption>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // H15 age gate: YYYY-MM-DD, validated client-side (age >= 13)
  // before any signup attempt; sent as `dateOfBirth` at
  // signup/complete (the server re-checks it).
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  // OTP stage: the digits live inside OtpCubes; the parent only
  // holds the phase, the same way guardian.tsx wires it.
  const [stage, setStage] = useState<'form' | 'otp'>('form');
  const [otpPhase, setOtpPhase] = useState<OtpPhase>('idle');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpNonce, setOtpNonce] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);

  // Turnstile bot-check token (6.3): see login.tsx — same widget,
  // same plumbing; passed to the signup OTP request-code calls.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const handleGoogle = async () => {
    // In-flight guard: rapid taps used to stack multiple auth browser
    // sessions on top of each other.
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        showAppDialog('Google Sign-Up Unavailable', error);
        return;
      }
      // H15 age gate for Google sign-up: OAuth creates the Supabase
      // account directly, so signup/complete's DOB check never runs.
      // Check the DOB on record BEFORE completing profile creation.
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
      // No DOB on record: the DOB field on this screen is the prompt
      // (same input + validation as the phone form below). Nothing is
      // completed until a valid DOB is posted to /auth/profile/dob.
      const dob = validateDateOfBirth(dateOfBirth);
      if (!dob.ok) {
        // Fail closed: drop the fresh Google session so the root
        // layout's auth listener cannot carry an under-gated account
        // into the tabs, and tell the user to enter a DOB and tap
        // Google again.
        await supabase.auth.signOut();
        showAppDialog(
          'Date of Birth Required',
          'Google sign-up needs your date of birth — you must be at least 13. Please enter it in the date of birth field below, then tap Continue with Google again.'
        );
        return;
      }
      const posted = await submitProfileDob(BACKEND_URL, dob.iso);
      if (!posted.reached || !posted.success) {
        // Fail closed: no DOB on record → no completed signup.
        await supabase.auth.signOut();
        showAppDialog(
          'Sign Up Incomplete',
          posted.reached
            ? posted.error || 'Your date of birth could not be saved. Please try signing up again.'
            : 'Could not reach the SafeLife servers. Please check your internet and try signing up again.'
        );
        return;
      }
      await ensureProfile(user);
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

    if (!cleanFirst || !cleanEmail || !password || !cleanPhone || !dateOfBirth.trim()) {
      showAppDialog(
        'Missing Details',
        'Please fill in your name, phone, email, password and date of birth.'
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
    if (!nationalDigitsValid(country.dial, cleanPhone)) {
      showAppDialog(
        'Invalid Phone',
        country.dial === '+91'
          ? 'Please enter a valid 10-digit Indian mobile number.'
          : 'Please enter a valid phone number for the selected country.'
      );
      return;
    }
    if (password.length < 6) {
      showAppDialog('Weak Password', 'Password must be at least 6 characters long.');
      return;
    }
    // H15: age gate runs BEFORE any signup attempt — no code is
    // requested and no account is created for an under-13 user.
    const dob = validateDateOfBirth(dateOfBirth);
    if (!dob.ok) {
      showAppDialog('Age Requirement', dob.error);
      return;
    }

    // Step 1: SMS the code to the mobile number, in E.164 with the
    // explicitly selected country code. No Supabase account is
    // created yet — that waits for the verified code + proof token.
    setLoading(true);
    try {
      const res = await requestSignupCode(BACKEND_URL, toE164(country.dial, cleanPhone), turnstileToken ?? undefined);
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

  // Step 3: spend the verify proof at signup/complete (the server
  // creates the account bound to the verified phone), then sign in
  // with the password. minDelayMs keeps the success animation
  // visible: the account is created IN PARALLEL with the animation
  // (total wait is the longer of the two, not their sum).
  const finishSignUp = async (proof: string, minDelayMs = 0) => {
    const startedAt = Date.now();
    const cleanEmail = email.trim().toLowerCase();
    const e164Phone = toE164(country.dial, phone.trim());
    // H15: re-validate the DOB at completion so a stale form state
    // can never send an unchecked value to signup/complete.
    const dobCheck = validateDateOfBirth(dateOfBirth);
    if (!dobCheck.ok) {
      showAppDialog('Age Requirement', dobCheck.error);
      setStage('form');
      setOtpPhase('idle');
      return;
    }
    try {
      const completed = await completeSignup(BACKEND_URL, {
        proof,
        email: cleanEmail,
        password,
        name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        phone: e164Phone,
        dateOfBirth: dobCheck.iso,
      });
      if (!completed.reached) {
        showAppDialog(
          'No Connection',
          'Could not reach the SafeLife servers. Check your internet and try again.'
        );
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      if (!completed.success) {
        showAppDialog('Sign Up Failed', 'Could not create the account. Please try again.');
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      // (2.4) Same per-email precheck as login.tsx: the account was
      // just created, so a 429 here means the email is being hammered
      // — do NOT attempt sign-in. Fail-open on precheck network error.
      const precheck = await checkLoginPrecheck(BACKEND_URL, cleanEmail);
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
        email: cleanEmail,
        password,
      });
      if (error) {
        showAppDialog('Sign Up Failed', friendlyAuthError(error));
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      if (data.session && data.user) {
        await ensureProfile(data.user);
        const elapsed = Date.now() - startedAt;
        if (minDelayMs > elapsed) {
          await new Promise((r) => setTimeout(r, minDelayMs - elapsed));
        }
        router.replace('/(tabs)');
      } else {
        // Email confirmation is off, so a session is expected — never
        // fail silently if it does not arrive.
        showAppDialog(
          'Sign Up Incomplete',
          'Your number verified, but sign-in did not finish. Please try logging in.'
        );
        setStage('form');
        setOtpPhase('idle');
      }
    } catch (e: any) {
      showAppDialog('Sign Up Failed', friendlyAuthError(e));
      setStage('form');
      setOtpPhase('idle');
    }
  };

  // OTP V4: the 6 digits arrive complete from OtpCubes; verification
  // is ONLY the server endpoint — no local comparison, no demo code.
  // On success the cube animation plays AND the Supabase account is
  // created at the same time (finishSignUp(2200) waits out the
  // animation only if sign-up finished first).
  const handleCodeComplete = async (submitted: string) => {
    if (!/^\d{6}$/.test(submitted)) return;
    setOtpPhase('verifying');
    setOtpError(null);
    setOtpBusy(true);
    try {
      const res = await verifySignupCode(BACKEND_URL, toE164(country.dial, phone.trim()), submitted);
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
      if (!res.success) {
        setOtpError(res.error || 'That code isn’t right. Please try again.');
        setOtpPhase('error');
        return;
      }
      if (!res.proof) {
        // Verify passed but no proof came back: the account cannot be
        // created bound to this phone — never fall back to a direct
        // signUp without proof.
        showAppDialog('Sign Up Failed', 'Verification did not return a proof. Please request a new code.');
        setStage('form');
        setOtpPhase('idle');
        return;
      }
      setOtpPhase('success');
      void finishSignUp(res.proof, 2200);
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
      const res = await requestSignupCode(BACKEND_URL, toE164(country.dial, phone.trim()), turnstileToken ?? undefined);
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
            <Text style={styles.headline}>Create your account</Text>
            <Text style={styles.sub}>
              Join the guardian network — we&apos;ll verify your mobile number.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(180).duration(500)} style={styles.card}>
            <View style={styles.toggleRow}>
              <Pressable
                style={styles.toggleBtn}
                onPress={() => router.push('/login')}
                hitSlop={6}
              >
                <Text style={styles.toggleText}>Sign in</Text>
              </Pressable>
              <Pressable style={[styles.toggleBtn, styles.toggleActive]} hitSlop={6}>
                <Text style={styles.toggleActiveText}>Create account</Text>
              </Pressable>
            </View>

            {stage === 'form' ? (
              <>
                <SocialButton provider="google" onPress={handleGoogle} variant="light" />

                <OrDivider label="or continue with mobile" />

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

                <View style={styles.phoneRow}>
                  <CountryPicker value={country} onChange={setCountry} />
                  <View style={styles.phoneInput}>
                    <AuthInput
                      icon="phone-outline"
                      placeholder="Phone number"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>
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
                  secureToggle
                  containerStyle={styles.fieldGap}
                />
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
                <Text style={styles.dobHint}>You must be at least 13 years old to create an account.</Text>

                <TurnstileWidget onToken={setTurnstileToken} />

                <AuthButton
                  title="Sign Up"
                  onPress={handleRegister}
                  loading={loading}
                  variant="white"
                  style={styles.cta}
                />

                <View style={styles.switchRow}>
                  <Text style={styles.switchText}>Have an account? </Text>
                  <Pressable onPress={() => router.push('/login')} hitSlop={8}>
                    <Text style={styles.switchLink}>Log In</Text>
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
                  <Text style={styles.otpSuccess}>Number verified — creating your account…</Text>
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
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  phoneRow: { flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'flex-start' },
  phoneInput: { flex: 1 },
  fieldGap: { marginTop: 14 },
  dobHint: {
    color: AuthTheme.colors.subtext,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 12,
    marginTop: 6,
  },
  cta: { marginTop: 24, marginBottom: 20 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  switchText: { color: AuthTheme.colors.subtext, fontFamily: AuthTheme.fonts.body, fontSize: 14 },
  switchLink: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.bodyBold,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
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
