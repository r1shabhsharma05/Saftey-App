import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Theme } from '../../constants/theme';
import type { SafetyScore, SafetyBand } from '../../utils/escapeLogic';

// D15 — one badge implementation for every surface that shows a safety
// score (SafeHubCard, PoliceStationCard, RouteMap). Band colour is never
// the only signal: the band word + number are always printed with it.
const BAND_STYLE: Record<SafetyBand, { backgroundColor: string; color: string }> = {
  SAFE: { backgroundColor: Theme.colors.success, color: '#00331a' },
  MODERATE: { backgroundColor: Theme.colors.warning, color: '#332500' },
  LOW: { backgroundColor: Theme.colors.error, color: '#330a08' },
};

export default function SafetyBadge({ safety }: { safety: SafetyScore }) {
  const style = BAND_STYLE[safety.band];
  return (
    <View
      style={[styles.pill, { backgroundColor: style.backgroundColor }]}
      accessibilityRole="text"
      accessibilityLabel={`Safety score ${safety.score} out of 100, ${safety.band.toLowerCase()}`}
    >
      <Text style={[styles.text, { color: style.color }]}>
        {safety.band} {safety.score}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  text: { fontFamily: Theme.fonts.headline, fontSize: 11, fontWeight: '900' },
});
