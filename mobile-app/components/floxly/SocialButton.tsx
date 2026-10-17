import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Floxly } from '../../constants/floxly';

interface Props {
  provider: 'google' | 'apple';
  onPress: () => void;
}

/**
 * Floxly-style social sign-in pill: dark rounded button with
 * the provider glyph, like the reference Google/Apple row.
 */
export default function SocialButton({ provider, onPress }: Props) {
  const label = provider === 'google' ? 'Google' : 'Apple';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <FontAwesome
        name={provider}
        size={20}
        color={provider === 'google' ? '#fff' : '#fff'}
        style={styles.icon}
      />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function OrDivider() {
  return (
    <View style={styles.orRow}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>Or</Text>
      <View style={styles.orLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Floxly.colors.pill,
    borderWidth: 1,
    borderColor: Floxly.colors.pillBorder,
    borderRadius: 18,
    height: 56,
  },
  pressed: { opacity: 0.7 },
  icon: { marginRight: 10 },
  label: {
    color: '#fff',
    fontFamily: Floxly.fonts.label,
    fontSize: 15,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: Floxly.colors.divider,
  },
  orText: {
    color: Floxly.colors.faint,
    fontFamily: Floxly.fonts.body,
    fontSize: 13,
    marginHorizontal: 14,
  },
});
