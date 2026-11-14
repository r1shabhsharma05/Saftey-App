import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { Theme } from '../../constants/theme';

interface Props {
  label: string;
  color: string;
  /** Pulsing dot — live states ONLY (an active SOS, a live GPS fix). A static state never pulses. */
  pulse?: boolean;
}

/**
 * Small status pill: tinted fill, signal dot, sentence-case label.
 * The dot is the signal; the word is never tracked caps.
 */
export default function StatusPill({ label, color, pulse = false }: Props) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (pulse) {
      opacity.value = withRepeat(withTiming(0.25, { duration: 900 }), -1, true);
    }
  }, [pulse, opacity]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={styles.pill}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, pulse && dotStyle]} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.systemFill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: {
    ...Theme.type.footnote,
    fontWeight: '600',
    color: Theme.colors.onSurface,
  },
});
