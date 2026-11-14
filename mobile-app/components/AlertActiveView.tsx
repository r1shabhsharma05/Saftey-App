import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import { rankSafePlaces, calculateBearing, getCardinalDirection, SafePlace } from '../utils/escapeLogic';
import { VICTIM_PRESET_MESSAGES, type AlertGuardiansSummary } from '../utils/guardian';
import {
  EMERGENCY_NUMBER,
  fetchNearestPoliceStation,
  formatPoliceDistance,
  type PoliceStation,
} from '../utils/police';
import Card from './ui/Card';
import AppleButton from './ui/AppleButton';
import StatusPill from './ui/StatusPill';
import SectionHeader from './ui/SectionHeader';
import SafeHubCard from './ui/SafeHubCard';
import PoliceStationCard from './ui/PoliceStationCard';

interface Props {
  onStop: () => void;
  lat: string;
  lng: string;
  cachedSafePlaces?: any[];
  // D5: per-channel receipts from D4's delivery engine
  // ({channel, state: delivered|partial|failed, attempts, reason?}).
  // Null until the SOS has reached the server — no card then, and
  // never a faked "all delivered" state.
  delivery?: any[] | null;
  // D10: distinct contact confirmations (0–2 needed to stop the
  // escalation ladder) + the ladder's schedule/runs, polled with the
  // receipts. Defaults keep older callers working.
  ackCount?: number;
  escalation?: any | null;
  // D11: the 5% final-burst outcome for this alert — 'sent' once the
  // final location reached contacts, 'failed' if it could not be
  // delivered, null if no burst was attempted yet.
  batteryFinalStatus?: 'sent' | 'failed' | null;
  // D21: the guardian summary polled with the receipts (null until
  // the first poll answers) + the victim's preset-message sender.
  guardians?: AlertGuardiansSummary | null;
  alertId?: string | null;
  onSendPreset?: (key: string) => void;
}

export default function AlertActiveView({ onStop, lat, lng, cachedSafePlaces = [], delivery = null, ackCount = 0, escalation = null, batteryFinalStatus = null, guardians = null, alertId = null, onSendPreset }: Props) {
  const [timer, setTimer] = useState(0);
  const [bestPlace, setBestPlace] = useState<SafePlace | null>(null);
  const [bearingHint, setBearingHint] = useState<string>('Calculating...');
  // D22: nearest police station for this alert — fetched once the SOS
  // screen mounts with a real GPS fix. 'empty' means no station within
  // 20 km, 'error' means the lookup failed; both are honest states,
  // and the 112 button below never depends on the lookup.
  const [station, setStation] = useState<PoliceStation | null>(null);
  const [stationState, setStationState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setStationState('error');
      return;
    }
    let cancelled = false;
    fetchNearestPoliceStation(latNum, lngNum)
      .then((res) => {
        if (cancelled) return;
        if (res.station) {
          setStation(res.station);
          setStationState('ready');
        } else {
          setStationState('empty');
        }
      })
      .catch(() => {
        if (!cancelled) setStationState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  useEffect(() => {
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (lat && lng && lat !== 'Loading...' && cachedSafePlaces.length > 0) {
      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);
      const ranked = rankSafePlaces(cachedSafePlaces, latNum, lngNum);
      if (ranked.length > 0) {
        setBestPlace(ranked[0]);
        const bearing = calculateBearing(latNum, lngNum, ranked[0].lat, ranked[0].lng);
        setBearingHint(`Head ${getCardinalDirection(bearing)}`);
      }
    }
  }, [lat, lng, cachedSafePlaces]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const getDistanceColor = (distance?: number) => {
    if (!distance) return Theme.colors.onSurfaceVariant;
    if (distance <= 200) return Theme.colors.successText;
    if (distance <= 500) return Theme.colors.warningText;
    return Theme.colors.errorText;
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Ionicons name="warning" size={22} color={Theme.colors.error} />
            <Text style={styles.brandTitle}>SafeLife</Text>
          </View>
          <StatusPill label="Live GPS" color={Theme.colors.success} pulse />
        </View>

        <View style={styles.badgeRow}>
          <StatusPill label={`Alert active · ${formatTime(timer)}`} color={Theme.colors.error} pulse />
        </View>

        {/* Escape HUD — no pulse, no animation: this screen is read under stress, and motion must not distract from the one action. */}
        <View>
          {bestPlace ? (
            <Card style={styles.escapeCard} borderRadius={28}>
              <Text style={styles.ctaHeading}>Run to this location</Text>
              <View style={styles.targetRow}>
                <Text style={styles.distanceMetric} numberOfLines={1} adjustsFontSizeToFit>
                  {Math.round(bestPlace.distance || 0)}m
                </Text>
                <View style={styles.targetCol}>
                  <Text style={[styles.directionHint, { color: getDistanceColor(bestPlace.distance) }]}>
                    {bearingHint}
                  </Text>
                  <Text style={styles.targetName} numberOfLines={2}>
                    {bestPlace.name}
                  </Text>
                </View>
              </View>
              <AppleButton
                title="Start navigation"
                variant="primary"
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/dir/?api=1&destination=${bestPlace.lat},${bestPlace.lng}`
                  )
                }
                icon={<Ionicons name="navigate" size={18} color="#FFFFFF" />}
              />
            </Card>
          ) : (
            <Card style={styles.fallback} borderRadius={28}>
              <Ionicons name="compass" size={42} color={Theme.colors.primary} />
              <Text style={styles.fallbackTitle}>Seek a crowded area</Text>
              <Text style={styles.fallbackSub}>
                Move towards a main road or a populated location immediately.
              </Text>
            </Card>
          )}
        </View>

        {/* Alternative routes — needs a real GPS fix: ranking against
            parseFloat('Loading...') is NaN, which used to scramble the
            order (rankSafePlaces now also refuses non-finite input). */}
        {cachedSafePlaces.length > 1 && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng)) && (
          <View style={styles.altSection}>
            <SectionHeader
              icon={<Ionicons name="map-outline" size={18} color={Theme.colors.primary} />}
              title="Alternative routes"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.altRow}>
              {rankSafePlaces(cachedSafePlaces, parseFloat(lat), parseFloat(lng))
                .slice(1, 10)
                .map((place, index) => (
                  <SafeHubCard
                    key={`${place.id}-${index}`}
                    place={place}
                    width={152}
                    ctaLabel="Go here instead"
                  />
                ))}
            </ScrollView>
          </View>
        )}

        {/* D5 delivery status — per-channel truth from the server,
            refreshed every 30s while the alert is active. A channel
            that has not landed yet says so; it is never shown as
            delivered. `channel-not-configured` (a channel whose
            server credentials are not set yet) reads as
            "Not connected yet", not "Failed". */}
        {delivery && delivery.length > 0 && (
          <View style={styles.deliverySection}>
            <SectionHeader
              icon={<Ionicons name="mail-outline" size={18} color={Theme.colors.primary} />}
              title="Delivery status"
            />
            <Card style={styles.deliveryCard}>
              {delivery.map((receipt: any, idx: number) => {
                const state = receipt.state === 'delivered'
                  ? 'Delivered'
                  : receipt.state === 'partial'
                    ? 'Partially delivered'
                    : receipt.reason === 'channel-not-configured'
                      ? 'Not connected yet'
                      : 'Failed';
                const color = receipt.state === 'delivered'
                  ? Theme.colors.successText
                  : receipt.state === 'partial'
                    ? Theme.colors.warningText
                    : receipt.reason === 'channel-not-configured'
                      ? Theme.colors.onSurfaceVariant
                      : Theme.colors.errorText;
                return (
                  <View key={`${receipt.channel}-${idx}`} style={styles.deliveryRow}>
                    <Text style={styles.deliveryChannel}>
                      {String(receipt.channel || 'channel').replace(/^\w/, (c) => c.toUpperCase())}
                    </Text>
                    <Text style={[styles.deliveryState, { color }]}>
                      {state}
                      {receipt.attempts > 1 ? ` · attempt ${receipt.attempts}` : ''}
                    </Text>
                  </View>
                );
              })}
              <Text style={styles.deliveryHint}>Updates every 30 seconds while this alert is active.</Text>
              {/* D10 confirmations + escalation: what the server's
                  ladder knows — never inferred from channel receipts.
                  A scheduled-but-unconfigured ladder says so instead
                  of pretending retries are coming. */}
              <Text style={[styles.deliveryState, { color: ackCount >= 2 ? Theme.colors.successText : Theme.colors.onSurfaceVariant }]}>
                {`Confirmations: ${ackCount} of 2 needed`}
              </Text>
              {(() => {
                const runs = Array.isArray(escalation?.runs) ? escalation.runs : [];
                const scheduled = Array.isArray(escalation?.scheduled) ? escalation.scheduled : [];
                if (runs.length > 0) {
                  const last = runs[runs.length - 1];
                  return <Text style={styles.deliveryHint}>{`Escalation step ${last.step} ran (${String(last.action || '')}).`}</Text>;
                }
                if (scheduled.some((s: any) => s.queued)) {
                  return <Text style={styles.deliveryHint}>Escalation scheduled: failed channels retry at 30s and 60s; a voice call follows at 2 min if unconfirmed.</Text>;
                }
                if (scheduled.length > 0) {
                  return <Text style={styles.deliveryHint}>Escalation could not be scheduled — the server has no delayed-job service configured yet.</Text>;
                }
                return null;
              })()}
              {/* D11 final burst: one honest line about the 5%
                  last-location send — never inferred from receipts. */}
              {batteryFinalStatus === 'sent' && (
                <Text style={styles.deliveryHint}>Final location sent to your contacts — battery was at 5%.</Text>
              )}
              {batteryFinalStatus === 'failed' && (
                <Text style={styles.deliveryHint}>Final-location alert could not be sent (battery 5%) — it is queued and will retry when the network returns.</Text>
              )}
            </Card>
          </View>
        )}

        {/* D21 guardians — who was notified, who is coming, how far,
            and preset messages. Null until the first status poll
            answers; "no guardians nearby" is shown honestly instead
            of an empty card. */}
        {guardians && (
          <View style={styles.deliverySection}>
            <SectionHeader
              icon={<Ionicons name="shield-checkmark-outline" size={18} color={Theme.colors.primary} />}
              title="Guardians"
            />
            <Card style={styles.deliveryCard}>
              {guardians.notified === 0 ? (
                <Text style={styles.deliveryHint}>No guardians nearby for this alert — your contacts were alerted.</Text>
              ) : (
                <>
                  {guardians.responses.map((r) => {
                    const loc = guardians.locations.find((l) => l.guardianId === r.guardianId);
                    return (
                      <View key={r.guardianId} style={styles.deliveryRow}>
                        <Text style={styles.deliveryChannel}>{r.name} · {r.role}</Text>
                        <Text style={[styles.deliveryState, { color: r.state === 'accepted' ? Theme.colors.successText : Theme.colors.onSurfaceVariant }]}>
                          {r.state === 'accepted'
                            ? `On the way${loc?.distanceKm != null ? ` · ${loc.distanceKm.toFixed(1)} km` : ''}`
                            : r.state === 'declined'
                              ? "Can't come"
                              : 'Notified'}
                        </Text>
                      </View>
                    );
                  })}
                  {guardians.messages.slice(-3).map((m, i) => (
                    <Text key={`${m.at}-${i}`} style={styles.deliveryHint}>
                      {m.from === 'victim' ? 'You: ' : `${m.name || 'Guardian'}: `}{m.text}
                    </Text>
                  ))}
                  {alertId && onSendPreset && (
                    <View style={styles.presetRow}>
                      {VICTIM_PRESET_MESSAGES.map((p) => (
                        <TouchableOpacity key={p.key} onPress={() => onSendPreset(p.key)} style={styles.presetChip} activeOpacity={0.7}>
                          <Text style={styles.presetText}>{p.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}
            </Card>
          </View>
        )}

        {/* D22 police — nearest station card + one-tap call + 112.
            The 112 button is always rendered: it never depends on the
            station lookup, so it works even with no station nearby or
            when the lookup fails. */}
        <View style={styles.deliverySection}>
          <SectionHeader
            icon={<Ionicons name="shield-outline" size={18} color={Theme.colors.primary} />}
            title="Police"
          />
          <Card style={styles.deliveryCard}>
            {stationState === 'loading' && (
              <Text style={styles.deliveryHint}>Finding nearest police station…</Text>
            )}
            {stationState === 'ready' && station && (
              <PoliceStationCard
                name={station.name || 'Police Station'}
                phone={station.phone || ''}
                distanceLabel={formatPoliceDistance(station.distanceKm)}
                direction={
                  Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))
                    ? getCardinalDirection(
                        calculateBearing(parseFloat(lat), parseFloat(lng), station.lat, station.lng)
                      )
                    : ''
                }
                lat={station.lat}
                lng={station.lng}
                safety={station.safety}
              />
            )}
            {stationState === 'empty' && (
              <Text style={styles.deliveryHint}>No police station found within 20 km — call 112 for help.</Text>
            )}
            {stationState === 'error' && (
              <Text style={styles.deliveryHint}>Station data unavailable — call 112 for help.</Text>
            )}
            <AppleButton
              title="Call 112 · National emergency number"
              variant="destructive"
              onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}
              icon={<Ionicons name="call" size={16} color="#FFFFFF" />}
            />
          </Card>
        </View>

        {/* Stop */}
        <View style={styles.stopWrap}>
          <AppleButton
            title="Stop alert"
            variant="destructive"
            onPress={onStop}
            icon={<Ionicons name="close-circle" size={20} color="#FFFFFF" />}
            style={styles.stopBtn}
          />
          <Text style={styles.stopHint}>Only stop when you are safe</Text>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.surface },
  container: { flexGrow: 1, padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTitle: { ...Theme.type.title2, color: Theme.colors.onSurface },
  badgeRow: { alignItems: 'center', marginBottom: 18 },
  escapeCard: { padding: 26, alignItems: 'center' },
  ctaHeading: {
    ...Theme.type.title2,
    color: Theme.colors.onSurface,
    marginBottom: 18,
  },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24, width: '100%' },
  targetCol: { flex: 1, marginLeft: 14 },
  distanceMetric: { fontSize: 58, fontWeight: '800', letterSpacing: -2, color: Theme.colors.onSurface },
  directionHint: { ...Theme.type.subhead, fontWeight: '600', marginBottom: 4 },
  targetName: { ...Theme.type.headline, fontWeight: '400', color: Theme.colors.onSurfaceVariant },
  fallback: { padding: 36, alignItems: 'center', gap: 10 },
  fallbackTitle: { ...Theme.type.title3, color: Theme.colors.onSurface, textAlign: 'center' },
  fallbackSub: { ...Theme.type.subhead, color: Theme.colors.onSurfaceVariant, textAlign: 'center', lineHeight: 21 },
  altSection: { marginTop: 26 },
  deliverySection: { marginTop: 26 },
  deliveryCard: { padding: 18, gap: 12 },
  deliveryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deliveryChannel: { ...Theme.type.headline, fontSize: 14, color: Theme.colors.onSurface },
  deliveryState: { ...Theme.type.caption1, fontWeight: '600', color: Theme.colors.onSurfaceVariant },
  deliveryHint: { ...Theme.type.caption2, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  presetChip: {
    borderWidth: 1,
    borderColor: Theme.colors.outlineVariant,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetText: { ...Theme.type.caption1, color: Theme.colors.onSurface },
  altRow: { gap: 12, paddingRight: 20 },
  stopWrap: { marginTop: 30, alignItems: 'center', gap: 10 },
  stopBtn: { width: 250 },
  stopHint: { ...Theme.type.caption2, color: Theme.colors.onSurfaceVariant },
});
