// Guardian home — SafeLife 2.0 Day 19 (plan §6 D19, plan §3 F2).
//
// One screen, three states: sign up (role + name + phone) → verify
// by SMS code → verified home with the availability toggle. The
// screen never claims more than the backend can do: while SMS is
// unconfigured it says so plainly and keeps the sign-up saved; the
// "how it works" copy names the alert flow as coming next (D21),
// not as live. The code is typed once, sent once, never stored.
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { ensureProfile } from '../utils/auth';
import { showAppDialog } from '../utils/dialog';
import { getBackendUrl } from '../utils/backendUrl';
import { secureGetItem, secureSetItem } from '../utils/secureStorage';
import { Theme } from '../constants/theme';
import ScreenBackground from '../components/ui/ScreenBackground';
import GlassCard from '../components/ui/GlassCard';
import StatusPill from '../components/ui/StatusPill';
import SectionHeader from '../components/ui/SectionHeader';
import GlowButton from '../components/ui/GlowButton';
import {
  GUARDIAN_ROLES,
  GUARDIAN_STORAGE_KEY,
  fetchGuardian,
  registerGuardian,
  requestVerificationCode,
  setGuardianAvailability,
  verifyGuardianCode,
  type Guardian,
  type GuardianRole,
} from '../utils/guardian';

// Backend URL comes from EXPO_PUBLIC_BACKEND_URL (see .env.example) —
// same fail-fast rule as the dashboard: no silent fallback.
const BACKEND_URL = getBackendUrl();

const ROLE_LABELS: Record<GuardianRole, string> = {
  family: 'Family',
  friend: 'Friend',
  volunteer: 'Volunteer',
  security: 'Security guard',
};

export default function GuardianScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<GuardianRole>('family');
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [smsUnavailable, setSmsUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSignedOut(true);
        return;
      }
      setUserId(user.id);
      await ensureProfile(user);
      const { data } = await supabase
        .from('profiles')
        .select('first_name,last_name,phone')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');
        if (fullName) setName(fullName);
        if (data.phone) setPhone(String(data.phone));
      }
      const stored = await secureGetItem(GUARDIAN_STORAGE_KEY).catch(() => null);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { id?: string };
          if (parsed?.id) {
            const live = await fetchGuardian(BACKEND_URL, parsed.id);
            if (live) setGuardian(live);
          }
        } catch {
          /* a stale store entry is not a guardian — the form stays */
        }
      }
    } catch (err) {
      console.log('Guardian load error:', (err as Error)?.message);
    } finally {
      setLoading(false);
    }
  };

  const rememberGuardian = async (g: Guardian) => {
    setGuardian(g);
    await secureSetItem(GUARDIAN_STORAGE_KEY, JSON.stringify({ id: g.id })).catch(() => {});
  };

  const handleRegister = async () => {
    if (!userId) return;
    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    if (!cleanName || !cleanPhone) {
      showAppDialog('Missing Details', 'Please enter your name and phone number.');
      return;
    }
    setBusy(true);
    try {
      const res = await registerGuardian(BACKEND_URL, { userId, name: cleanName, phone: cleanPhone, role });
      if (!res.reached) {
        showAppDialog('No Connection', 'Could not reach the SafeLife servers. Check your internet and try again.');
        return;
      }
      if (!res.success || !res.guardian) {
        showAppDialog('Sign-up Failed', res.error || 'Something went wrong. Please try again.');
        return;
      }
      await rememberGuardian(res.guardian);
      await handleRequestCode(res.guardian.id);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestCode = async (id?: string) => {
    const gid = id || guardian?.id;
    if (!gid) return;
    setBusy(true);
    try {
      const res = await requestVerificationCode(BACKEND_URL, gid);
      if (!res.reached) {
        showAppDialog('No Connection', 'Could not reach the SafeLife servers. Check your internet and try again.');
        return;
      }
      if (res.sent) {
        setCodeSent(true);
        setSmsUnavailable(false);
        return;
      }
      // Honest degradation: SMS is not configured yet (the standing
      // httpSMS blocker) — the sign-up stays saved, verification waits.
      if (res.reason === 'channel-not-configured') {
        setSmsUnavailable(true);
        showAppDialog(
          'SMS Not Set Up Yet',
          'SafeLife cannot send the verification code until the SMS gateway is connected. Your guardian sign-up is saved — try again once it is live.'
        );
        return;
      }
      showAppDialog('Code Not Sent', res.error || 'The code could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    if (!guardian) return;
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      showAppDialog('Invalid Code', 'Enter the 6-digit code sent to your phone.');
      return;
    }
    setBusy(true);
    try {
      const res = await verifyGuardianCode(BACKEND_URL, guardian.id, cleanCode);
      if (!res.reached) {
        showAppDialog('No Connection', 'Could not reach the SafeLife servers. Check your internet and try again.');
        return;
      }
      if (!res.success || !res.guardian) {
        showAppDialog('Verification Failed', res.error || 'Something went wrong. Please try again.');
        return;
      }
      setCode('');
      setCodeSent(false);
      await rememberGuardian(res.guardian);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (value: boolean) => {
    if (!guardian) return;
    setToggleBusy(true);
    try {
      const res = await setGuardianAvailability(BACKEND_URL, guardian.id, value);
      if (!res.reached) {
        showAppDialog('No Connection', 'Could not reach the SafeLife servers. Availability was not changed.');
        return;
      }
      if (!res.success || !res.guardian) {
        showAppDialog('Not Changed', res.error || 'Availability was not changed. Please try again.');
        return;
      }
      await rememberGuardian(res.guardian);
    } finally {
      setToggleBusy(false);
    }
  };

  const statusPill = !guardian
    ? { label: 'NOT A GUARDIAN', color: Theme.colors.onSurfaceVariant, pulse: false }
    : guardian.state === 'pending'
      ? { label: 'VERIFYING', color: Theme.colors.warning, pulse: true }
      : guardian.available
        ? { label: 'ON DUTY', color: Theme.colors.success, pulse: true }
        : { label: 'VERIFIED · OFF DUTY', color: Theme.colors.primary, pulse: false };

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={Theme.colors.onSurface} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Guardian home</Text>
          <View style={styles.backBtn} />
        </View>

        {loading ? (
          <GlassCard>
            <Text style={styles.copy}>Loading your guardian status…</Text>
          </GlassCard>
        ) : signedOut ? (
          <GlassCard>
            <Text style={styles.copy}>Sign in to become a Guardian — your account is how SafeLife knows who is helping.</Text>
          </GlassCard>
        ) : (
          <>
            <GlassCard edgeColor={Theme.colors.primaryContainer}>
              <View style={styles.statusRow}>
                <MaterialCommunityIcons name="shield-check" size={26} color={Theme.colors.primary} />
                <View style={styles.statusText}>
                  <Text style={styles.statusTitle}>Guardian Network</Text>
                  <Text style={styles.statusSub}>
                    {guardian ? `${guardian.name} · ${ROLE_LABELS[guardian.role]}` : 'Verified people, nearby rescue'}
                  </Text>
                </View>
                <StatusPill label={statusPill.label} color={statusPill.color} pulse={statusPill.pulse} />
              </View>
            </GlassCard>

            {!guardian && (
              <GlassCard>
                <SectionHeader
                  icon={<MaterialCommunityIcons name="account-plus" size={18} color={Theme.colors.primary} />}
                  title="Become a Guardian"
                />
                <Text style={styles.copy}>
                  Guardians are verified people nearby who get an SOS alert when someone close needs help. Start with
                  family and friends — the trusted circle first.
                </Text>
                <Text style={styles.label}>Your name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor={Theme.colors.onSurfaceVariant}
                  autoCapitalize="words"
                />
                <Text style={styles.label}>Phone (for the verification code)</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+91 …"
                  placeholderTextColor={Theme.colors.onSurfaceVariant}
                  keyboardType="phone-pad"
                />
                <Text style={styles.label}>I am joining as</Text>
                <View style={styles.chips}>
                  {GUARDIAN_ROLES.map((r) => (
                    <TouchableOpacity
                      key={r.value}
                      onPress={() => setRole(r.value)}
                      style={[styles.chip, role === r.value && styles.chipActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, role === r.value && styles.chipTextActive]}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <GlowButton title="Sign up as Guardian" onPress={handleRegister} loading={busy} style={styles.button} />
              </GlassCard>
            )}

            {guardian && guardian.state === 'pending' && (
              <GlassCard>
                <SectionHeader
                  icon={<MaterialCommunityIcons name="message-text" size={18} color={Theme.colors.primary} />}
                  title="Verify your phone"
                />
                {smsUnavailable ? (
                  <>
                    <Text style={styles.copy}>
                      SMS verification is not set up yet — SafeLife cannot send the code until the SMS gateway is
                      connected. Your sign-up is saved; come back and try again once it is live.
                    </Text>
                    <GlowButton title="Try again" onPress={() => handleRequestCode()} loading={busy} variant="ghost" style={styles.button} />
                  </>
                ) : (
                  <>
                    <Text style={styles.copy}>
                      {codeSent
                        ? `We sent a 6-digit code to ${guardian.phone}. Enter it below — it expires in 10 minutes.`
                        : `We will send a 6-digit code to ${guardian.phone}. Enter it below to prove this number is yours.`}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.codeInput]}
                      value={code}
                      onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      placeholderTextColor={Theme.colors.onSurfaceVariant}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    <GlowButton
                      title={codeSent ? 'Verify code' : 'Send code'}
                      onPress={codeSent ? handleVerify : () => handleRequestCode()}
                      loading={busy}
                      style={styles.button}
                    />
                    {codeSent && (
                      <GlowButton title="Resend code" onPress={() => handleRequestCode()} variant="ghost" loading={busy} style={styles.button} />
                    )}
                  </>
                )}
              </GlassCard>
            )}

            {guardian && guardian.state === 'verified' && (
              <>
                <GlassCard>
                  <SectionHeader
                    icon={<MaterialCommunityIcons name="radar" size={18} color={Theme.colors.primary} />}
                    title="Availability"
                  />
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleText}>
                      <Text style={styles.toggleTitle}>{guardian.available ? 'On duty' : 'Off duty'}</Text>
                      <Text style={styles.toggleSub}>
                        {guardian.available
                          ? 'Nearby SOS alerts will reach this phone.'
                          : 'Turn on to receive nearby SOS alerts.'}
                      </Text>
                    </View>
                    <Switch
                      value={guardian.available}
                      onValueChange={handleToggle}
                      disabled={toggleBusy}
                      trackColor={{ false: Theme.colors.surfaceBright, true: Theme.colors.successDim }}
                      thumbColor={guardian.available ? Theme.colors.success : Theme.colors.onSurfaceVariant}
                    />
                  </View>
                  <Text style={styles.meta}>Verified {guardian.verifiedAt ? new Date(guardian.verifiedAt).toLocaleDateString() : ''} · {guardian.phone}</Text>
                </GlassCard>
                <GlassCard>
                  <SectionHeader
                    icon={<MaterialCommunityIcons name="information" size={18} color={Theme.colors.primary} />}
                    title="How it works"
                  />
                  <Text style={styles.copy}>
                    When someone near you sends an SOS, verified guardians on duty get an alert with their live
                    location. Accepting an alert, live tracking and preset messages arrive with the alert flow — this
                    screen manages your guardian status for now.
                  </Text>
                </GlassCard>
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 120, gap: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: Theme.fonts.headline, fontSize: 19, color: Theme.colors.onSurface },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusText: { flex: 1 },
  statusTitle: { fontFamily: Theme.fonts.headline, fontSize: 17, color: Theme.colors.onSurface },
  statusSub: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  copy: { fontFamily: Theme.fonts.body, fontSize: 13, color: Theme.colors.onSurfaceVariant, lineHeight: 19 },
  label: { fontFamily: Theme.fonts.label, fontSize: 11, color: Theme.colors.onSurfaceVariant, marginTop: 14, marginBottom: 6, letterSpacing: 1 },
  input: {
    fontFamily: Theme.fonts.body,
    fontSize: 15,
    color: Theme.colors.onSurface,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeInput: { textAlign: 'center', letterSpacing: 6, fontSize: 20, marginTop: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: { borderColor: Theme.colors.primary, backgroundColor: 'rgba(0, 227, 253, 0.12)' },
  chipText: { fontFamily: Theme.fonts.body, fontSize: 13, color: Theme.colors.onSurfaceVariant },
  chipTextActive: { color: Theme.colors.onSurface },
  button: { marginTop: 16 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  toggleText: { flex: 1 },
  toggleTitle: { fontFamily: Theme.fonts.headline, fontSize: 16, color: Theme.colors.onSurface },
  toggleSub: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 2, lineHeight: 17 },
  meta: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 12 },
});
