// Guardian Network card — SafeLife 2.0 Day 19 (plan §6 D19, plan §3 F2).
//
// One component, four states: not a guardian yet, verification
// pending, verified on duty, verified off duty. The dashboard owns
// the guardian state and the server calls; this card only renders
// and reports the tap (same split as JourneyCard). The full
// onboarding / verification / toggle flow lives in app/guardian.tsx.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import Card from './ui/Card';
import StatusPill from './ui/StatusPill';
import AppleButton from './ui/AppleButton';
import type { Guardian } from '../utils/guardian';

interface GuardianCardProps {
  /** The guardian record, or null when this user has not signed up. */
  guardian: Guardian | null;
  onOpen: () => void;
}

export default function GuardianCard({ guardian, onOpen }: GuardianCardProps) {
  const status = !guardian
    ? { pill: 'Not a guardian', color: Theme.colors.onSurfaceVariant, pulse: false }
    : guardian.state === 'pending'
      ? { pill: 'Verifying', color: Theme.colors.warning, pulse: true }
      : guardian.available
        ? { pill: 'On duty', color: Theme.colors.success, pulse: true }
        : { pill: 'Verified · Off duty', color: Theme.colors.primary, pulse: false };

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
    <Card>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={24} color={Theme.colors.primary} />
        <View style={styles.titleBox}>
          <Text style={styles.title}>Guardian network</Text>
          <Text style={styles.subtitle}>Nearby rescue, by verified people</Text>
        </View>
        <StatusPill label={status.pill} color={status.color} pulse={status.pulse} />
      </View>
      <Text style={styles.copy}>{copy}</Text>
      <AppleButton title={cta} onPress={onOpen} variant="tinted" style={styles.button} />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleBox: { flex: 1 },
  title: { ...Theme.type.headline, color: Theme.colors.onSurface },
  subtitle: { ...Theme.type.subhead, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  copy: { ...Theme.type.footnote, lineHeight: 19, color: Theme.colors.onSurfaceVariant, marginTop: 12 },
  button: { marginTop: 14 },
});
