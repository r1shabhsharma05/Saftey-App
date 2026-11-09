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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import GlassCard from './ui/GlassCard';
import StatusPill from './ui/StatusPill';
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
    <GlassCard style={styles.card} borderRadius={20} intensity={16}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <MaterialCommunityIcons name="map-marker-path" size={20} color={Theme.colors.primary} />
        </View>
        <View style={styles.titleBox}>
          <Text style={styles.title}>Journey Guardian</Text>
          <Text style={styles.subtitle}>
            {journey ? 'Your contacts can follow this trip live' : 'Share a trip so contacts can follow you'}
          </Text>
        </View>
        {journey && (
          <StatusPill
            label={journey.overdue ? 'OVERDUE' : 'ON THE WAY'}
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
              Past your ETA — if you are safe, tap ARRIVED so your contacts stop worrying.
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
                  <Text style={styles.buttonText}>I&apos;M OK</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.helpButton]}
                  onPress={() => onCheckIn(false)}
                  disabled={checkInBusy}
                  activeOpacity={0.8}
                >
                  <Text style={styles.buttonText}>I NEED HELP</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.shareButton]} onPress={onShare} activeOpacity={0.8}>
              <Text style={styles.buttonText}>SHARE LINK</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.arrivedButton]}
              onPress={onArrived}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>I ARRIVED</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onCancel} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.buttonText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.idleBody}>
          <Text style={styles.pickerLabel}>DESTINATION</Text>
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
          <Text style={styles.pickerLabel}>ARRIVE IN</Text>
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
          <TouchableOpacity
            style={[styles.startButton, (!selected || busy) && styles.startButtonDisabled]}
            onPress={() => selected && onStart(selected, etaMinutes)}
            disabled={!selected || busy}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate" size={16} color={Theme.colors.primary} />
            <Text style={styles.startButtonText}>START JOURNEY</Text>
          </TouchableOpacity>
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBox: { flex: 1 },
  title: { fontFamily: Theme.fonts.headline, fontSize: 15, color: Theme.colors.onSurface },
  subtitle: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  idleBody: { gap: 10 },
  activeBody: { gap: 8 },
  pickerLabel: { fontFamily: Theme.fonts.label, fontSize: 10, color: Theme.colors.onSurfaceVariant, letterSpacing: 1 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    maxWidth: 180,
  },
  chipSelected: { borderColor: Theme.colors.primary, backgroundColor: 'rgba(0, 227, 253, 0.10)' },
  chipText: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  chipTextSelected: { color: Theme.colors.primary },
  noPlaces: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, lineHeight: 16 },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
    borderWidth: 1,
    borderColor: Theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 12,
  },
  startButtonDisabled: { opacity: 0.4 },
  startButtonText: { fontFamily: Theme.fonts.label, fontSize: 12, color: Theme.colors.primary, letterSpacing: 1 },
  destination: { fontFamily: Theme.fonts.headline, fontSize: 16, color: Theme.colors.onSurface },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  meta: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  updated: { fontFamily: Theme.fonts.body, fontSize: 11, color: Theme.colors.onSurfaceVariant },
  overdueText: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.error, lineHeight: 16 },
  checkInBox: {
    borderWidth: 1,
    borderColor: Theme.colors.error,
    backgroundColor: 'rgba(255, 80, 80, 0.08)',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  checkInTitle: { fontFamily: Theme.fonts.headline, fontSize: 15, color: Theme.colors.onSurface },
  checkInText: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, lineHeight: 16 },
  checkInRow: { flexDirection: 'row', gap: 8 },
  okButton: { backgroundColor: 'rgba(0, 227, 253, 0.10)', borderWidth: 1, borderColor: Theme.colors.primary },
  helpButton: { backgroundColor: 'rgba(255, 80, 80, 0.16)', borderWidth: 1, borderColor: Theme.colors.error },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  shareButton: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  arrivedButton: { backgroundColor: 'rgba(0, 227, 253, 0.10)', borderWidth: 1, borderColor: Theme.colors.primary },
  cancelButton: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' },
  buttonText: { fontFamily: Theme.fonts.label, fontSize: 10, color: Theme.colors.primary, letterSpacing: 1 },
});
