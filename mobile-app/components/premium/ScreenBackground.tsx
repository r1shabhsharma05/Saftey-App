import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  /** accent glow color for the aurora orbs */
  accent?: string;
}

/**
 * Premium screen backdrop: deep gradient + two aurora orbs.
 * Every screen shares one consistent, cinematic background.
 */
export default function ScreenBackground({ children, accent = Theme.colors.primaryContainer }: Props) {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Theme.colors.surfaceDim, Theme.colors.surface]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.orb, styles.orbTop, { backgroundColor: accent + '1f' }]} />
      <View style={[styles.orb, styles.orbBottom, { backgroundColor: Theme.colors.secondary + '12' }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.colors.surface },
  orb: { position: 'absolute', width: 420, height: 420, borderRadius: 210 },
  orbTop: { top: -140, right: -140 },
  orbBottom: { bottom: -160, left: -160 },
});
