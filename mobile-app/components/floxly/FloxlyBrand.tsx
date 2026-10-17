import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Floxly } from '../../constants/floxly';

/**
 * Centered SafeLife AI brand mark for auth screens —
 * glowing shield in a gradient ring + wordmark, like the
 * reference's centered "Floxly" logo.
 */
export default function FloxlyBrand({ compact }: { compact?: boolean }) {
  const size = compact ? 64 : 84;
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={Floxly.gradients.logoRing}
        style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.inner, { borderRadius: size / 2 - 4 }]}>
          <MaterialCommunityIcons
            name="shield-check"
            size={compact ? 30 : 40}
            color="#fff"
          />
        </View>
      </LinearGradient>
      <Text style={[styles.wordmark, compact && styles.wordmarkCompact]}>
        SafeLife AI
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  ring: {
    padding: 3,
    shadowColor: '#7cc4ff',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  inner: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 55, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: 14,
    color: '#fff',
    fontFamily: Floxly.fonts.headline,
    fontSize: 26,
    letterSpacing: 0.5,
  },
  wordmarkCompact: { fontSize: 20, marginTop: 10 },
});
