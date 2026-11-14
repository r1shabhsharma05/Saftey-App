import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import Card from './Card';
import SafetyBadge from './SafetyBadge';
import type { SafetyScore } from '../../utils/escapeLogic';
import { sanitizePhone } from '../../utils/escapeLogic';

interface Props {
  name: string;
  phone: string;
  distanceLabel: string;
  direction: string;
  lat: number;
  lng: number;
  safety?: SafetyScore;
}

/** Police-station row: call + navigation actions, no decoration. */
export default function PoliceStationCard({ name, phone, distanceLabel, direction, lat, lng, safety }: Props) {
  // (M3) The phone is OSM crowd-edited text: allowlist it here (the
  // parser does too — this is the last stop before tel:). Anything
  // implausible dials the 100 emergency number instead, and the
  // separators are stripped from the tel: URI itself.
  const dialNumber = sanitizePhone(phone, '100');

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {safety && <SafetyBadge safety={safety} />}
        <View style={styles.distBadge}>
          <Ionicons name="compass" size={12} color={Theme.colors.success} />
          <Text style={styles.distText}>
            {distanceLabel} {direction}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.callBtn}
          activeOpacity={0.7}
          onPress={() => Linking.openURL(`tel:${dialNumber.replace(/[\s\-()]/g, '')}`)}
        >
          <Ionicons name="call" size={15} color={Theme.colors.onSurface} />
          <Text style={styles.callText}>
            {dialNumber === '100' ? '100 · Emergency' : dialNumber}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navBtn}
          activeOpacity={0.8}
          onPress={() =>
            Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
          }
        >
          <Ionicons name="navigate" size={13} color="#FFFFFF" />
          <Text style={styles.navText}>Go</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  name: {
    flex: 1,
    ...Theme.type.subhead,
    fontWeight: '600',
    color: Theme.colors.onSurface,
  },
  distBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  distText: { ...Theme.type.caption1, fontWeight: '600', color: Theme.colors.successText },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Theme.colors.systemFill,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
  },
  callText: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Theme.colors.primaryFill,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
  },
  navText: { ...Theme.type.caption1, fontWeight: '700', color: '#FFFFFF' },
});
