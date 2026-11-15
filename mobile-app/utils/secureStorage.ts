// (M2) Secrets live in the OS keychain/keystore, not plaintext
// AsyncStorage. The Supabase session (access + refresh tokens), the
// queued SOS payload (name, phone, live location), the journey
// share link and the emergency contacts are sensitive: a rooted
// device, a backup, or another app reading the AsyncStorage file
// must not find them in the clear.
//
// Web has no keychain, so tokens live only in memory — nothing is
// written to localStorage, and a refresh forces re-login. On native,
// values are read from SecureStore; a value still sitting in
// AsyncStorage from before this change is migrated once (copied to
// SecureStore, deleted from AsyncStorage). If SecureStore refuses
// the migration copy (e.g. the 2048-byte Android cap), the plaintext
// AsyncStorage copy is DELETED and null is returned — the user signs
// in again instead of the app silently serving a plaintext token.
//
// Android limit: SecureStore values cap at 2048 bytes — the Supabase
// session JSON sits well under that for this app; if it ever grew
// past it, the write throws and the session is not persisted (the
// user signs in again) rather than being stored in the clear.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Static rendering runs in Node, where Platform.OS is 'web' but there
// is no window — AsyncStorage dereferences `window` and crashes. A
// render-time read has nothing to recover, so the three functions
// below return null / no-op in that case. On a real device or browser
// `window` exists, so behaviour there is unchanged.
const isNodeRender = Platform.OS === 'web' && typeof window === 'undefined';

// Web token store: memory only, never localStorage — a refresh
// forces re-login by design (13.1/2.6).
const webMemory = new Map<string, string>();

export const secureGetItem = async (key: string): Promise<string | null> => {
  if (isNodeRender) return null;
  if (Platform.OS === 'web') return webMemory.get(key) ?? null;
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(key);
  } catch {
    // Keychain unavailable (e.g. device locked): treat as no value
    // rather than crashing auth init.
    return null;
  }
  if (stored !== null) return stored;
  // One-time migration: pre-M2 values live in AsyncStorage.
  const legacy = await AsyncStorage.getItem(key).catch(() => null);
  if (legacy === null) return null;
  try {
    await SecureStore.setItemAsync(key, legacy);
    await AsyncStorage.removeItem(key).catch(() => {});
  } catch {
    // SecureStore refused it (e.g. over the 2048-byte Android cap):
    // delete the plaintext copy and return null — never serve the
    // legacy plaintext value; the user signs in again.
    await AsyncStorage.removeItem(key).catch(() => {});
    return null;
  }
  return legacy;
};

export const secureSetItem = async (key: string, value: string): Promise<void> => {
  if (isNodeRender) return;
  if (Platform.OS === 'web') {
    webMemory.set(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Write refused (e.g. over the 2048-byte Android cap): delete any
    // plaintext legacy copy and do NOT persist the value — the
    // session/queue is lost and the user signs in again, rather than
    // the value landing in the clear. Swallowed (not thrown) so a
    // refused persist can never break sign-in itself.
    await AsyncStorage.removeItem(key).catch(() => {});
  }
};

export const secureRemoveItem = async (key: string): Promise<void> => {
  if (isNodeRender) return;
  if (Platform.OS === 'web') {
    webMemory.delete(key);
    return;
  }
  // Delete from both stores: a pre-M2 plaintext copy must not survive
  // a removal that only cleared the secure one.
  await SecureStore.deleteItemAsync(key).catch(() => {});
  await AsyncStorage.removeItem(key).catch(() => {});
};
