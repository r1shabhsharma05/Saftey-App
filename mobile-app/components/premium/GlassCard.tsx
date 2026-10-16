import React from 'react';
import { StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  borderRadius?: number;
  /** subtle colored edge light, e.g. a category accent */
  edgeColor?: string;
}

/**
 * Liquid-glass card: frosted blur, hairline border, top sheen highlight.
 * The 2026 premium surface — use for every content card.
 */
export default function GlassCard({
  children,
  style,
  intensity = 24,
  borderRadius = Theme.roundness.lg,
  edgeColor,
}: Props) {
  return (
    <BlurView
      intensity={intensity}
      tint="dark"
      style={[
        styles.base,
        {
          borderRadius,
          borderColor: edgeColor ? edgeColor + '55' : 'rgba(255,255,255,0.10)',
        },
        style,
      ]}
    >
      <LinearGradient
        colors={Theme.gradients.glassSheen}
        style={[styles.sheen, { borderRadius }]}
        pointerEvents="none"
      />
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: 'rgba(30, 30, 55, 0.42)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 72,
  },
});
