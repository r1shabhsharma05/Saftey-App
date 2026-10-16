import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ScrollView,
  Linking,
} from 'react-native';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import { rankSafePlaces, calculateBearing, getCardinalDirection, SafePlace } from '../../utils/escapeLogic';
import ScreenBackground from '../premium/ScreenBackground';
import GlassCard from '../premium/GlassCard';
import GlowButton from '../premium/GlowButton';
import StatusPill from '../premium/StatusPill';
import SectionHeader from '../premium/SectionHeader';
import SafeHubCard from '../premium/SafeHubCard';

interface Props {
  onStop: () => void;
  lat: string;
  lng: string;
  cachedSafePlaces?: any[];
}

export default function AlertActiveView({ onStop, lat, lng, cachedSafePlaces = [] }: Props) {
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

        {/* Alternative routes */}
        {cachedSafePlaces.length > 1 && (
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
  altRow: { gap: 12, paddingRight: 20 },
  stopWrap: { marginTop: 30, alignItems: 'center', gap: 10 },
  stopBtn: { width: 250 },
  stopHint: { fontFamily: Theme.fonts.label, fontSize: 10, color: Theme.colors.onSurfaceVariant, letterSpacing: 1.5 },
});
