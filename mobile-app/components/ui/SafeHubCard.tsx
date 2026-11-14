import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, categoryMeta } from '../../constants/theme';
import Card from './Card';
import SafetyBadge from './SafetyBadge';
import type { SafetyScore } from '../../utils/escapeLogic';

export interface SafePlace {
  id: number | string;
  name: string;
  category: string;
  distance?: number;
  lat: number;
  lng: number;
  safety?: SafetyScore;
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
export default function SafeHubCard({ place, width = 148, ctaLabel = 'Get directions' }: Props) {
  const meta = categoryMeta(place.category);
  const dist = place.distance ?? 0;
  const displayDist = dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;

  return (
    <Card style={[styles.card, { width }]} borderRadius={20}>
      <View style={styles.header}>
        <View style={[styles.iconDot, { backgroundColor: meta.color + '1F' }]}>
          <Ionicons name={meta.icon as any} size={22} color={meta.color} />
        </View>
        <Text style={styles.distance}>{displayDist}</Text>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {place.name}
      </Text>
      {place.safety && <SafetyBadge safety={place.safety} />}
      <TouchableOpacity
        style={styles.cta}
        activeOpacity={0.7}
        onPress={() =>
          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`)
        }
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </Card>
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
  distance: { ...Theme.type.subhead, fontWeight: '600', color: Theme.colors.primaryText },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    color: Theme.colors.onSurface,
  },
  cta: {
    backgroundColor: Theme.colors.systemFill,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
  },
  ctaText: {
    ...Theme.type.caption1,
    fontWeight: '600',
    color: Theme.colors.primaryText,
  },
});
