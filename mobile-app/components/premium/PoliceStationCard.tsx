import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import GlassCard from './GlassCard';

interface Props {
  name: string;
  phone: string;
  distanceLabel: string;
  direction: string;
  lat: number;
  lng: number;
}

/** Premium police-station row: glass card, call + navigation actions. */
export default function PoliceStationCard({ name, phone, distanceLabel, direction, lat, lng }: Props) {
  const dialNumber = phone !== 'N/A' ? phone : '100';

  return (
    <GlassCard style={styles.card} edgeColor={Theme.colors.police} intensity={16}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
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
          onPress={() => Linking.openURL(`tel:${dialNumber}`)}
        >
          <Ionicons name="call" size={15} color={Theme.colors.onSurface} />
          <Text style={styles.callText}>
            {phone !== 'N/A' ? phone : '100 · Emergency'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navBtn}
          activeOpacity={0.8}
          onPress={() =>
            Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`)
          }
        >
          <FontAwesome5 name="directions" size={13} color="#00331a" />
          <Text style={styles.navText}>GO</Text>
        </TouchableOpacity>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  name: {
    flex: 1,
    fontFamily: Theme.fonts.headline,
    fontSize: 14,
    color: Theme.colors.onSurface,
  },
  distBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 136, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 136, 0.20)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    gap: 5,
  },
  distText: { fontFamily: Theme.fonts.headline, fontSize: 11, color: Theme.colors.success },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
  },
  callText: { fontFamily: Theme.fonts.label, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Theme.colors.success,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    shadowColor: Theme.colors.success,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  navText: { fontFamily: Theme.fonts.headline, fontSize: 12, color: '#00331a', fontWeight: '900' },
});
