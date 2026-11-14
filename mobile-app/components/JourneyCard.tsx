// Journey Guardian card — SafeLife 2.0 Day 16 (plan §6 D16, plan §3 F4).
//
// Two states, one component: idle (pick a destination + ETA, start
// the trip) and active (live trip: destination, ETA, distance left,
// share / arrived / cancel). The dashboard owns the journey state
// and the server calls; this card only renders and reports taps.
//
// shortcut: the destination picker lists nearby safe places only —
// a free-form destination (map tap / address search) is a D18
// polish candidate, not a D16 scope item. A trip to anywhere else
// still works through SOS + live tracking; it just cannot be a
// Journey Guardian trip yet.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import Card from './ui/Card';
import StatusPill from './ui/StatusPill';
import AppleButton from './ui/AppleButton';
import type { SafePlace } from '../utils/escapeLogic';
import {
  JOURNEY_ETA_OPTIONS,
  formatEta,
  minutesRemaining,
  type Journey,
} from '../utils/journey';

interface JourneyCardProps {
  /** Ranked nearby safe places — the top 5 are offered as destinations. */
  places: SafePlace[];
  /** The active journey, or null when no trip is running. */
  journey: Journey | null;
  /** Metres from the current position to the destination, when known. */
  distanceRemainingM: number | null;
  busy: boolean;
  onStart: (place: SafePlace, etaMinutes: number) => void;
  onShare: () => void;
  onArrived: () => void;
  onCancel: () => void;
  /** D17: answer the server's "Sab theek hai?" prompt. */
  onCheckIn: (ok: boolean) => void;
  /** True while a check-in answer is in flight. */
  checkInBusy: boolean;
}

// D17: one line per watch reason, in the traveller's own words.
const CHECKIN_COPY: Record<string, string> = {
  deviated: "You're off your route.",
  stopped: "You haven't moved in a while.",
  overdue: "You're past your expected arrival time.",
};

const formatDistance = (m: number | null): string => {
  if (m === null || !Number.isFinite(m)) return '—';
  return m > 1000 ? `${(m / 1000).toFixed(1)} km left` : `${Math.round(m)} m left`;
};

const formatUpdated = (iso: string | null): string => {
  if (!iso) return 'No update yet';
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 60) return `Updated ${secs}s ago`;
  return `Updated ${Math.round(secs / 60)} min ago`;
};

export default function JourneyCard({
  places,
  journey,
  distanceRemainingM,
  busy,
  onStart,
  onShare,
  onArrived,
  onCancel,
  onCheckIn,
  checkInBusy,
}: JourneyCardProps) {
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  const [etaMinutes, setEtaMinutes] = useState(25);
  const options = places.slice(0, 5);
  const selected = options.find((p) => p.id === selectedId) ?? options[0] ?? null;

  return (
    <Card style={styles.card} borderRadius={20}>
      <View style={styles.header}>
        <Ionicons name="map-outline" size={20} color={Theme.colors.primary} />
        <View style={styles.titleBox}>
          <Text style={styles.title}>Journey guardian</Text>
          <Text style={styles.subtitle}>
            {journey ? 'Your contacts can follow this trip live' : 'Share a trip so contacts can follow you'}
          </Text>
        </View>
        {journey && (
          <StatusPill
            label={journey.overdue ? 'Overdue' : 'On the way'}
            color={journey.overdue ? Theme.colors.error : Theme.colors.success}
            pulse={!journey.overdue}
          />
        )}
      </View>

      {journey ? (
        <View style={styles.activeBody}>
          <Text style={styles.destination} numberOfLines={1}>
            → {journey.destination.label}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>ETA {formatEta(journey.expectedArrivalAt)}</Text>
            <Text style={styles.meta}>
              {journey.overdue ? 'Overdue' : `${minutesRemaining(journey)} min left`}
            </Text>
            <Text style={styles.meta}>{formatDistance(distanceRemainingM)}</Text>
          </View>
          <Text style={styles.updated}>{formatUpdated(journey.locationAt)}</Text>
          {journey.overdue && (
            <Text style={styles.overdueText}>
              Past your ETA — if you are safe, tap Arrived so your contacts stop worrying.
            </Text>
          )}
          {journey.checkIn && (
            <View style={styles.checkInBox} accessibilityRole="alert">
              <Text style={styles.checkInTitle}>Sab theek hai?</Text>
              <Text style={styles.checkInText}>
                {CHECKIN_COPY[journey.checkIn.reason] ?? 'SafeLife needs to hear from you.'}{' '}
                Answer now — no answer in 5 minutes alerts your emergency contacts.
              </Text>
              <View style={styles.checkInRow}>
                <TouchableOpacity
                  style={[styles.button, styles.okButton]}
                  onPress={() => onCheckIn(true)}
                  disabled={checkInBusy}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.buttonText, { color: Theme.colors.primaryText }]}>I&apos;m OK</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.helpButton]}
                  onPress={() => onCheckIn(false)}
                  disabled={checkInBusy}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.buttonText, { color: Theme.colors.errorText }]}>I need help</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.shareButton]} onPress={onShare} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Share link</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.arrivedButton]}
              onPress={onArrived}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>I arrived</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onCancel} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.idleBody}>
          <Text style={styles.pickerLabel}>Destination</Text>
          {options.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {options.map((place) => (
                <TouchableOpacity
                  key={String(place.id)}
                  style={[styles.chip, selected?.id === place.id && styles.chipSelected]}
                  onPress={() => setSelectedId(place.id)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[styles.chipText, selected?.id === place.id && styles.chipTextSelected]}
                    numberOfLines={1}
                  >
                    {place.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.noPlaces}>No nearby safe places yet — the trip picker appears once places load.</Text>
          )}
          <Text style={styles.pickerLabel}>Arrive in</Text>
          <View style={styles.chipRow}>
            {JOURNEY_ETA_OPTIONS.map((mins) => (
              <TouchableOpacity
                key={mins}
                style={[styles.chip, etaMinutes === mins && styles.chipSelected]}
                onPress={() => setEtaMinutes(mins)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, etaMinutes === mins && styles.chipTextSelected]}>{mins} min</Text>
              </TouchableOpacity>
            ))}
          </View>
          <AppleButton
            title="Start journey"
            variant="tinted"
            onPress={() => selected && onStart(selected, etaMinutes)}
            disabled={!selected || busy}
            icon={<Ionicons name="navigate" size={16} color={Theme.colors.primaryText} />}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleBox: { flex: 1 },
  title: { ...Theme.type.headline, color: Theme.colors.onSurface },
  subtitle: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant },
  idleBody: { gap: 10 },
  activeBody: { gap: 8 },
  pickerLabel: { ...Theme.type.caption2, color: Theme.colors.onSurfaceVariant },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: Theme.colors.systemFill,
    borderWidth: 1,
    borderColor: Theme.colors.outlineVariant,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    maxWidth: 180,
  },
  chipSelected: { borderColor: Theme.colors.primary, backgroundColor: Theme.colors.primaryContainer },
  chipText: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant },
  chipTextSelected: { color: Theme.colors.primaryText, fontWeight: '600' },
  noPlaces: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant, lineHeight: 16 },
  destination: { ...Theme.type.subhead, fontWeight: '600', color: Theme.colors.onSurface },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant },
  updated: { ...Theme.type.caption2, color: Theme.colors.onSurfaceVariant },
  overdueText: { ...Theme.type.caption1, color: Theme.colors.errorText, lineHeight: 16 },
  checkInBox: {
    borderWidth: 1,
    borderColor: Theme.colors.error,
    backgroundColor: Theme.colors.errorContainer,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  checkInTitle: { ...Theme.type.headline, color: Theme.colors.onSurface },
  checkInText: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant, lineHeight: 16 },
  checkInRow: { flexDirection: 'row', gap: 8 },
  okButton: { backgroundColor: Theme.colors.primaryContainer },
  helpButton: { backgroundColor: Theme.colors.errorContainer },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  shareButton: { backgroundColor: Theme.colors.systemFill },
  arrivedButton: { backgroundColor: Theme.colors.primaryFill },
  cancelButton: { backgroundColor: Theme.colors.systemFill },
  buttonText: { ...Theme.type.footnote, fontWeight: '600', color: Theme.colors.onSurface },
});
