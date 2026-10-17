import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme, categoryMeta } from '../../constants/theme';
import GlassCard from './GlassCard';

export interface SafePlace {
  id: number | string;
  name: string;
  category: string;
  distance?: number;
  lat: number;
  lng: number;
}

interface Props {
  place: SafePlace;
  width?: number;
  ctaLabel?: string;
}

/**
 * Shared safe-place card — one implementation used by the dashboard
 * and the alert HUD (was duplicated in both).
 */
export default function SafeHubCard({ place, width = 148, ctaLabel = 'GET DIRECTIONS' }: Props) {
  const meta = categoryMeta(place.category);
  const dist = place.distance ?? 0;
  const displayDist = dist > 1000 ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`;

  return (
    <GlassCard style={[styles.card, { width }]} borderRadius={20} intensity={16}>
      <View style={styles.header}>
        <View style={[styles.iconDot, { backgroundColor: meta.color + '1f' }]}>
          <MaterialCommunityIcons name={meta.icon as any} size={22} color={meta.color} />
        </View>
        <Text style={styles.distance}>{displayDist}</Text>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {place.name}
      </Text>
      <TouchableOpacity
        style={styles.cta}
        activeOpacity={0.7}
        onPress={() =>
          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`)
        }
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconDot: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distance: { fontFamily: Theme.fonts.headline, fontSize: 13, color: Theme.colors.primary },
  name: {
    flex: 1,
    fontFamily: Theme.fonts.body,
    fontSize: 12,
    color: Theme.colors.onSurfaceVariant,
    lineHeight: 16,
  },
  cta: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: Theme.fonts.label,
    fontSize: 10,
    color: Theme.colors.primary,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
