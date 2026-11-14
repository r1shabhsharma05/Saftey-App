import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Theme } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
}

/**
 * Apple card (HIG lists-and-tables.md): flat surface, 1px hairline,
 * no shadow, no blur, no gradient. Glass lives ONLY on the floating
 * tab bar (liquid-glass.md) — never on cards, rows or content.
 * Drop-in replacement for GlassCard on dashboard screens.
 */
export default function Card({ children, style, borderRadius = Theme.roundness.default }: Props) {
  return <View style={[styles.base, { borderRadius }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Theme.colors.surfaceContainer,
    borderWidth: 1,
    borderColor: Theme.colors.outlineVariant,
  },
});
