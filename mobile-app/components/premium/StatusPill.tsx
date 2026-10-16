import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';
import { Theme } from '../../constants/theme';

interface Props {
  label: string;
  color: string;
  /** pulsing dot for live states */
  pulse?: boolean;
}

/** Status pill with an (optionally pulsing) signal dot. */
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
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: color, shadowColor: color },
          pulse && dotStyle,
        ]}
      />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  label: {
    fontFamily: Theme.fonts.label,
    fontSize: 10,
    color: Theme.colors.onSurface,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
});
