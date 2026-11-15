// H18 force-update screen: a blocking full-screen notice with no
// bypass — no dismiss button, no back path, it renders above the
// whole navigator (see app/_layout.tsx). The Update button opens
// the GitHub Releases page (PLAY_STORE_URL) — SafeLife is not on
// the Play Store, it ships as an APK; if the page cannot be opened
// the user stays on this screen (still no bypass — an outdated
// build must not reach SOS flows).
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PLAY_STORE_URL, getAppVersion } from '../utils/forceUpdate';

interface ForceUpdateScreenProps {
  minSupportedVersion?: string;
  latestVersion?: string;
}

export default function ForceUpdateScreen({ minSupportedVersion, latestVersion }: ForceUpdateScreenProps) {
  const [storeError, setStoreError] = useState(false);

  const openStore = async () => {
    setStoreError(false);
    try {
      const ok = await Linking.canOpenURL(PLAY_STORE_URL);
      if (!ok) {
        setStoreError(true);
        return;
      }
      await Linking.openURL(PLAY_STORE_URL);
    } catch {
      setStoreError(true);
    }
  };

  return (
    <View style={styles.root}>
      <MaterialCommunityIcons name="shield-alert-outline" size={72} color="#f59e0b" />
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.body}>
        This version of SafeLife ({getAppVersion()}) is no longer supported
        {minSupportedVersion ? ` — version ${minSupportedVersion} or newer is required` : ''}. Please update to
        continue using SafeLife.
      </Text>
      {latestVersion ? <Text style={styles.version}>Latest version: {latestVersion}</Text> : null}
      <Pressable style={styles.button} onPress={openStore} hitSlop={8}>
        <Text style={styles.buttonText}>Update SafeLife</Text>
      </Pressable>
      {storeError ? (
        <Text style={styles.error}>
          Could not open the download page. Please update SafeLife from GitHub Releases to continue.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0c0c1d',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  body: { color: '#a1a1aa', fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 12 },
  version: { color: '#71717a', fontSize: 13, marginTop: 10 },
  button: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 28,
  },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  error: { color: '#f87171', fontSize: 13, textAlign: 'center', marginTop: 16, lineHeight: 19 },
});
