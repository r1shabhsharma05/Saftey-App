import React from 'react';
import {
  Text,
  StyleSheet,
  ViewStyle,
  StyleProp,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../constants/theme';

type Variant = 'primary' | 'success' | 'danger' | 'ghost';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<Variant, { colors: [string, string]; glow: string; text: string }> = {
  primary: { colors: Theme.gradients.primary, glow: Theme.glow.primary, text: '#003840' },
  success: { colors: Theme.gradients.success, glow: Theme.glow.success, text: '#00331a' },
  danger: { colors: Theme.gradients.danger, glow: Theme.glow.danger, text: '#fff' },
  ghost: { colors: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.03)'], glow: 'transparent', text: Theme.colors.onSurface },
};

/**
 * Premium CTA button: gradient fill, neon glow, springy press physics,
 * built-in loading state. Replaces every TouchableOpacity CTA.
 */
export default function GlowButton({
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
      onPressIn={() => (scale.value = withSpring(0.96, { damping: 14 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 14 }))}
      style={({ pressed }) => [pressed && { opacity: 0.92 }]}
    >
      <Animated.View
        style={[
          styles.base,
          {
            shadowColor: v.glow === 'transparent' ? '#000' : v.colors[1],
            borderColor: variant === 'ghost' ? 'rgba(255,255,255,0.14)' : 'transparent',
          },
          animatedStyle,
          style,
        ]}
      >
        <LinearGradient
          colors={v.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          {loading ? (
            <ActivityIndicator color={v.text} />
          ) : (
            <>
              {icon}
              <Text style={[styles.title, { color: v.text }]}>{title}</Text>
            </>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 58,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  gradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  title: {
    fontFamily: Theme.fonts.headline,
    fontSize: 15,
    letterSpacing: 2,
    fontWeight: '900',
  },
});
