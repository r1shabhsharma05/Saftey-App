import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { AuthTheme } from '../../constants/auth-theme';

interface Props {
  provider: 'google' | 'apple';
  onPress: () => void;
  /** 'light' = the globe auth page's white Google button. */
  variant?: 'dark' | 'light';
}

// The 4-color Google "G" from the landing auth page (auth-with-globe.tsx).
function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.56-5.16 3.56-8.81z"
      />
      <Path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"
      />
      <Path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z"
      />
      <Path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </Svg>
  );
}

/**
 * Floxly-style social sign-in pill: dark rounded button with
 * the provider glyph, like the reference Google/Apple row.
 * variant="light" is the globe auth page's white Google button.
 */
export default function SocialButton({ provider, onPress, variant = 'dark' }: Props) {
  const label = provider === 'google' ? 'Google' : 'Apple';
  const light = variant === 'light';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.btn, light && styles.btnLight, pressed && styles.pressed]}
    >
      {provider === 'google' && light ? (
        <View style={styles.icon}>
          <GoogleIcon size={20} />
        </View>
      ) : (
        <FontAwesome
          name={provider}
          size={20}
          color="#fff"
          style={styles.icon}
        />
      )}
      <Text style={[styles.label, light && styles.labelLight]}>{label}</Text>
    </Pressable>
  );
}

export function OrDivider({ label = 'Or' }: { label?: string }) {
  return (
    <View style={styles.orRow}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>{label}</Text>
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
    backgroundColor: AuthTheme.colors.pill,
    borderWidth: 1,
    borderColor: AuthTheme.colors.pillBorder,
    borderRadius: 18,
    height: 56,
  },
  pressed: { opacity: 0.7 },
  btnLight: {
    backgroundColor: '#fff',
    borderColor: '#fff',
    borderRadius: 12,
    height: 52,
  },
  labelLight: { color: '#000' },
  icon: { marginRight: 10 },
  label: {
    color: '#fff',
    fontFamily: AuthTheme.fonts.label,
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
    backgroundColor: AuthTheme.colors.divider,
  },
  orText: {
    color: AuthTheme.colors.faint,
    fontFamily: AuthTheme.fonts.body,
    fontSize: 13,
    marginHorizontal: 14,
  },
});
