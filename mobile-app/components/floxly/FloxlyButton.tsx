import React from 'react';
import {
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Floxly } from '../../constants/floxly';

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Floxly-style CTA: bright blue→cyan gradient pill with glow,
 * like the reference "Log In" / "Continue" buttons.
 */
export default function FloxlyButton({ title, onPress, loading, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.touch, pressed && styles.pressed, style]}
    >
      <LinearGradient
        colors={Floxly.gradients.cta}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: {
    borderRadius: 20,
    shadowColor: '#22d3ee',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  gradient: {
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontFamily: Floxly.fonts.title,
    fontSize: 17,
  },
});
