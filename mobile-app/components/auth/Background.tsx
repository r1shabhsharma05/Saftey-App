import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthTheme } from '../../constants/auth-theme';

interface Props {
  children: ReactNode;
}

/**
 * Floxly-style auth background: vivid blue gradient with soft
 * radial glows, matching the reference screens.
 */
export default function AuthBackground({ children }: Props) {
  return (
    <View style={styles.root}>
      <LinearGradient
        colors={AuthTheme.gradients.background}
        locations={[0, 0.45, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Top-left bright wash */}
      <View style={styles.glowTop} />
      {/* Cyan accent glow, mid-right */}
      <View style={styles.glowMid} />
      {/* Bottom vignette for legibility */}
      <LinearGradient
        colors={['transparent', 'rgba(4, 10, 26, 0.55)']}
        style={styles.vignette}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  glowTop: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(140, 200, 255, 0.35)',
  },
  glowMid: {
    position: 'absolute',
    top: '38%',
    right: -110,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
  },
  vignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
  },
});
