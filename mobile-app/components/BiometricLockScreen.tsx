// Biometric lock screen — shown INSTEAD of the tabs when the
// fingerprint lock is on (see app/_layout.tsx). Nothing behind it
// is reachable until authenticateForUnlock() succeeds; a cancelled
// attempt just stays here with a retry button — it never
// auto-navigates past the lock and never loops the prompt.
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import { authenticateForUnlock } from '../utils/biometricLock';

export default function BiometricLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const attempt = async () => {
    if (await authenticateForUnlock()) onUnlocked();
  };

  return (
    <View style={styles.root}>
      <MaterialCommunityIcons
        name="shield-lock-outline"
        size={64}
        color={Theme.colors.primary}
      />
      <Text style={styles.title}>SafeLife is locked</Text>
      <Text style={styles.sub}>
        Unlock with your fingerprint or device passcode to continue.
      </Text>
      <Pressable onPress={attempt} style={styles.button}>
        <Ionicons name="finger-print-outline" size={20} color="#00331a" />
        <Text style={styles.buttonText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: {
    fontFamily: Theme.fonts.headline,
    fontSize: 22,
    color: Theme.colors.onSurface,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Theme.fonts.body,
    fontSize: 14,
    color: Theme.colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Theme.colors.primaryContainer,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonText: {
    fontFamily: Theme.fonts.label,
    fontSize: 15,
    color: '#00331a',
  },
});
