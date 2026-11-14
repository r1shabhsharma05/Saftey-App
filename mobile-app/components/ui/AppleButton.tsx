import React from 'react';
import {
  Text,
  StyleSheet,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Theme } from '../../constants/theme';

type Variant = 'primary' | 'tinted' | 'destructive' | 'plain';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// HIG buttons.md: one prominent action per view, verb-led label,
// 44pt minimum hit region, always a press state. Press feedback is a
// 0.97 scale in 100ms (animate-expo) — no spring, no glow, no gradient.
// Colours are the contrast-checked tokens: white on primaryFill /
// errorFill passes 4.5:1 in both appearances; tinted text uses
// primaryText, which passes on the tint (contrast_check.py).
const VARIANTS: Record<Variant, { backgroundColor: string; text: string }> = {
  primary: { backgroundColor: Theme.colors.primaryFill, text: '#FFFFFF' },
  tinted: { backgroundColor: Theme.colors.primaryContainer, text: Theme.colors.primaryText },
  destructive: { backgroundColor: Theme.colors.errorFill, text: '#FFFFFF' },
  plain: { backgroundColor: 'transparent', text: Theme.colors.primaryText },
};

export default function AppleButton({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: Props) {
  const scale = useSharedValue(1);
  const v = VARIANTS[variant];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      onPressIn={() => (scale.value = withTiming(0.97, { duration: 100 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 100 }))}
    >
      <Animated.View
        style={[
          styles.base,
          { backgroundColor: v.backgroundColor },
          disabled && styles.disabled,
          animatedStyle,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={v.text} />
        ) : (
          <>
            {icon}
            <Text style={[styles.title, { color: v.text }]}>{title}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  disabled: { opacity: 0.4 },
  title: { ...Theme.type.headline, fontSize: 17 },
});
