import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ScrollView,
  Linking,
  TouchableOpacity,
} from 'react-native';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import { rankSafePlaces, calculateBearing, getCardinalDirection, SafePlace } from '../utils/escapeLogic';
import { VICTIM_PRESET_MESSAGES, type AlertGuardiansSummary } from '../utils/guardian';
import ScreenBackground from './ui/ScreenBackground';
import GlassCard from './ui/GlassCard';
import GlowButton from './ui/GlowButton';
import StatusPill from './ui/StatusPill';
import SectionHeader from './ui/SectionHeader';
import SafeHubCard from './ui/SafeHubCard';

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
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [bestPlace, setBestPlace] = useState<SafePlace | null>(null);
  const [bearingHint, setBearingHint] = useState<string>('Calculating...');

  useEffect(() => {
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();

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
        setBearingHint(`HEAD ${getCardinalDirection(bearing).toUpperCase()}`);
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
    if (distance <= 200) return Theme.colors.success;
    if (distance <= 500) return Theme.colors.warning;
    return Theme.colors.error;
  };

  return (
    <ScreenBackground accent={Theme.colors.error}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Reanimated.View entering={FadeInUp.duration(400)} style={styles.header}>
          <View style={styles.headerTitleRow}>
            <MaterialCommunityIcons name="shield-alert" size={22} color={Theme.colors.tertiary} />
            <Text style={styles.brandTitle}>SafeLife AI</Text>
          </View>
          <StatusPill label="LIVE GPS" color={Theme.colors.tertiary} pulse />
        </Reanimated.View>

        <Reanimated.View entering={FadeInUp.delay(80).duration(400)} style={styles.badgeRow}>
          <StatusPill label={`ALERT ACTIVE · ${formatTime(timer)}`} color={Theme.colors.tertiary} pulse />
        </Reanimated.View>

        {/* Escape HUD */}
        <Reanimated.View entering={FadeInUp.delay(140).duration(500)}>
          {bestPlace ? (
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <GlassCard
                style={styles.escapeCard}
                edgeColor={getDistanceColor(bestPlace.distance)}
                borderRadius={28}
                intensity={30}
              >
                <Text style={styles.ctaHeading}>RUN TO THIS LOCATION</Text>
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
                <GlowButton
                  title="START NAVIGATION"
                  variant="success"
                  onPress={() =>
                    Linking.openURL(
                      `https://www.google.com/maps/dir/?api=1&destination=${bestPlace.lat},${bestPlace.lng}`
                    )
                  }
                  icon={<FontAwesome5 name="directions" size={18} color="#00331a" />}
                />
              </GlassCard>
            </Animated.View>
          ) : (
            <GlassCard style={styles.fallback} edgeColor={Theme.colors.tertiary} borderRadius={28}>
              <Ionicons name="compass" size={42} color={Theme.colors.tertiary} />
              <Text style={styles.fallbackTitle}>SEEK CROWDED AREA</Text>
              <Text style={styles.fallbackSub}>
                Move towards a main road or a populated location immediately.
              </Text>
            </GlassCard>
          )}
        </Reanimated.View>

        {/* Alternative routes — needs a real GPS fix: ranking against
            parseFloat('Loading...') is NaN, which used to scramble the
            order (rankSafePlaces now also refuses non-finite input). */}
        {cachedSafePlaces.length > 1 && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng)) && (
          <Reanimated.View entering={FadeInUp.delay(220).duration(500)} style={styles.altSection}>
            <SectionHeader
              icon={<MaterialCommunityIcons name="routes" size={18} color={Theme.colors.primary} />}
              title="Alternative Routes"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.altRow}>
              {rankSafePlaces(cachedSafePlaces, parseFloat(lat), parseFloat(lng))
                .slice(1, 10)
                .map((place, index) => (
                  <SafeHubCard
                    key={`${place.id}-${index}`}
                    place={place}
                    width={152}
                    ctaLabel="GO HERE INSTEAD"
                  />
                ))}
            </ScrollView>
          </Reanimated.View>
        )}

        {/* D5 delivery status — per-channel truth from the server,
            refreshed every 30s while the alert is active. A channel
            that has not landed yet says so; it is never shown as
            delivered. `channel-not-configured` (a channel whose
            server credentials are not set yet) reads as
            "Not connected yet", not "Failed". */}
        {delivery && delivery.length > 0 && (
          <Reanimated.View entering={FadeInUp.delay(260).duration(500)} style={styles.deliverySection}>
            <SectionHeader
              icon={<MaterialCommunityIcons name="email-check" size={18} color={Theme.colors.primary} />}
              title="Delivery Status"
            />
            <GlassCard style={styles.deliveryCard}>
              {delivery.map((receipt: any, idx: number) => {
                const state = receipt.state === 'delivered'
                  ? 'Delivered'
                  : receipt.state === 'partial'
                    ? 'Partially delivered'
                    : receipt.reason === 'channel-not-configured'
                      ? 'Not connected yet'
                      : 'Failed';
                const color = receipt.state === 'delivered'
                  ? Theme.colors.success
                  : receipt.state === 'partial'
                    ? Theme.colors.warning
                    : receipt.reason === 'channel-not-configured'
                      ? Theme.colors.onSurfaceVariant
                      : Theme.colors.error;
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
              <Text style={[styles.deliveryState, { color: ackCount >= 2 ? Theme.colors.success : Theme.colors.onSurfaceVariant }]}>
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
            </GlassCard>
          </Reanimated.View>
        )}

        {/* D21 guardians — who was notified, who is coming, how far,
            and preset messages. Null until the first status poll
            answers; "no guardians nearby" is shown honestly instead
            of an empty card. */}
        {guardians && (
          <Reanimated.View entering={FadeInUp.delay(280).duration(500)} style={styles.deliverySection}>
            <SectionHeader
              icon={<MaterialCommunityIcons name="shield-check" size={18} color={Theme.colors.primary} />}
              title="Guardians"
            />
            <GlassCard style={styles.deliveryCard}>
              {guardians.notified === 0 ? (
                <Text style={styles.deliveryHint}>No guardians nearby for this alert — your contacts were alerted.</Text>
              ) : (
                <>
                  {guardians.responses.map((r) => {
                    const loc = guardians.locations.find((l) => l.guardianId === r.guardianId);
                    return (
                      <View key={r.guardianId} style={styles.deliveryRow}>
                        <Text style={styles.deliveryChannel}>{r.name} · {r.role}</Text>
                        <Text style={[styles.deliveryState, { color: r.state === 'accepted' ? Theme.colors.success : Theme.colors.onSurfaceVariant }]}>
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
            </GlassCard>
          </Reanimated.View>
        )}

        {/* Stop */}
        <Reanimated.View entering={FadeInUp.delay(300).duration(500)} style={styles.stopWrap}>
          <GlowButton
            title="STOP ALERT"
            variant="danger"
            onPress={onStop}
            icon={<Ionicons name="close-circle" size={20} color="#fff" />}
            style={styles.stopBtn}
          />
          <Text style={styles.stopHint}>Only stop when you are safe</Text>
        </Reanimated.View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandTitle: { fontFamily: Theme.fonts.headline, fontSize: 22, color: Theme.colors.tertiary, letterSpacing: -0.5 },
  badgeRow: { alignItems: 'center', marginBottom: 18 },
  escapeCard: { padding: 26, alignItems: 'center' },
  ctaHeading: {
    fontFamily: Theme.fonts.headline,
    fontSize: 13,
    color: Theme.colors.onSurface,
    letterSpacing: 3,
    marginBottom: 18,
  },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24, width: '100%' },
  targetCol: { flex: 1, marginLeft: 14 },
  distanceMetric: { fontFamily: Theme.fonts.headline, fontSize: 58, color: '#fff', fontWeight: '900', letterSpacing: -2 },
  directionHint: { fontFamily: Theme.fonts.headline, fontSize: 13, letterSpacing: 2, marginBottom: 4 },
  targetName: { fontFamily: Theme.fonts.body, fontSize: 15, color: Theme.colors.onSurfaceVariant, fontWeight: '600' },
  fallback: { padding: 36, alignItems: 'center', gap: 10 },
  fallbackTitle: { fontFamily: Theme.fonts.headline, fontSize: 19, color: Theme.colors.tertiary, textAlign: 'center' },
  fallbackSub: { fontFamily: Theme.fonts.body, fontSize: 14, color: Theme.colors.onSurfaceVariant, textAlign: 'center', lineHeight: 21 },
  altSection: { marginTop: 26 },
  deliverySection: { marginTop: 26 },
  deliveryCard: { padding: 18, gap: 12 },
  deliveryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deliveryChannel: { fontFamily: Theme.fonts.headline, fontSize: 14, color: Theme.colors.onSurface },
  deliveryState: { fontFamily: Theme.fonts.label, fontSize: 12, letterSpacing: 0.5 },
  deliveryHint: { fontFamily: Theme.fonts.body, fontSize: 11, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  presetChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  presetText: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurface },
  altRow: { gap: 12, paddingRight: 20 },
  stopWrap: { marginTop: 30, alignItems: 'center', gap: 10 },
  stopBtn: { width: 250 },
  stopHint: { fontFamily: Theme.fonts.label, fontSize: 10, color: Theme.colors.onSurfaceVariant, letterSpacing: 1.5 },
});
