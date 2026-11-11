// Guardian Network card — SafeLife 2.0 Day 19 (plan §6 D19, plan §3 F2).
//
// One component, four states: not a guardian yet, verification
// pending, verified on duty, verified off duty. The dashboard owns
// the guardian state and the server calls; this card only renders
// and reports the tap (same split as JourneyCard). The full
// onboarding / verification / toggle flow lives in app/guardian.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import GlassCard from './ui/GlassCard';
import StatusPill from './ui/StatusPill';
import GlowButton from './ui/GlowButton';
import type { Guardian } from '../utils/guardian';

interface GuardianCardProps {
  /** The guardian record, or null when this user has not signed up. */
  guardian: Guardian | null;
  onOpen: () => void;
}

export default function GuardianCard({ guardian, onOpen }: GuardianCardProps) {
  const status = !guardian
    ? { pill: 'NOT A GUARDIAN', color: Theme.colors.onSurfaceVariant, pulse: false }
    : guardian.state === 'pending'
      ? { pill: 'VERIFYING', color: Theme.colors.warning, pulse: true }
      : guardian.available
        ? { pill: 'ON DUTY', color: Theme.colors.success, pulse: true }
        : { pill: 'VERIFIED · OFF DUTY', color: Theme.colors.primary, pulse: false };

  const copy = !guardian
    ? 'Become a verified Guardian — when someone near you sends an SOS, guardians on duty get the alert.'
    : guardian.state === 'pending'
      ? `Finish verification — enter the SMS code sent to ${guardian.phone}.`
      : guardian.available
        ? 'You are a verified Guardian and on duty. Nearby SOS alerts will reach this phone.'
        : 'You are verified. Turn availability on to receive nearby SOS alerts.';

  const cta = !guardian
    ? 'Become a Guardian'
    : guardian.state === 'pending'
      ? 'Enter verification code'
      : 'Guardian home';

  return (
    <GlassCard edgeColor={Theme.colors.primaryContainer}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <MaterialCommunityIcons name="shield-check" size={24} color={Theme.colors.primary} />
        </View>
        <View style={styles.titleBox}>
          <Text style={styles.title}>Guardian Network</Text>
          <Text style={styles.subtitle}>Nearby rescue, by verified people</Text>
        </View>
        <StatusPill label={status.pill} color={status.color} pulse={status.pulse} />
      </View>
      <Text style={styles.copy}>{copy}</Text>
      <GlowButton title={cta} onPress={onOpen} variant="ghost" style={styles.button} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 227, 253, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBox: { flex: 1 },
  title: { fontFamily: Theme.fonts.headline, fontSize: 17, color: Theme.colors.onSurface },
  subtitle: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  copy: { fontFamily: Theme.fonts.body, fontSize: 13, color: Theme.colors.onSurfaceVariant, lineHeight: 19, marginTop: 12 },
  button: { marginTop: 14 },
});
