import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';
import type { SafetyScore, SafetyBand } from '../../utils/escapeLogic';

// D15 — one badge implementation for every surface that shows a safety
// score (SafeHubCard, PoliceStationCard, RouteMap). Band colour is never
// the only signal: the band word + number are always printed with it.
// Solid fills with dark text — the only combination that passes 4.5:1
// in both appearances (contrast_check.py). The sparkles mark the score
// as the AI-computed element (sparkles motif: AI only).
const BAND_STYLE: Record<SafetyBand, { backgroundColor: string; color: string; word: string }> = {
  SAFE: { backgroundColor: Theme.colors.success, color: '#052E16', word: 'Safe' },
  MODERATE: { backgroundColor: Theme.colors.warning, color: '#331D00', word: 'Moderate' },
  LOW: { backgroundColor: Theme.colors.error, color: '#2B0503', word: 'Low' },
};

export default function SafetyBadge({ safety }: { safety: SafetyScore }) {
  const style = BAND_STYLE[safety.band];
  return (
    <View
      style={[styles.pill, { backgroundColor: style.backgroundColor }]}
      accessibilityRole="text"
      accessibilityLabel={`Safety score ${safety.score} out of 100, ${style.word.toLowerCase()}`}
    >
      <Ionicons name="sparkles" size={11} color={style.color} />
      <Text style={[styles.text, { color: style.color }]}>
        {style.word} {safety.score}
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
    gap: 4,
  },
  text: { ...Theme.type.caption1, fontWeight: '700' },
});
