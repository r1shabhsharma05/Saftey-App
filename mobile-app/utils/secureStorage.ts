// (M2) Secrets live in the OS keychain/keystore, not plaintext
// AsyncStorage. The Supabase session (access + refresh tokens), the
// queued SOS payload (name, phone, live location) and the journey
// share link are sensitive: a rooted device, a backup, or another
// app reading the AsyncStorage file must not find them in the clear.
//
// expo-secure-store is native-only in spirit — on web it has no
// keychain, so web keeps AsyncStorage (same exposure as before, but
// the web build is not the shipped app). On native, values are read
// from SecureStore; a value still sitting in AsyncStorage from before
// this change is migrated once (copied to SecureStore, deleted from
// AsyncStorage) so no user is logged out and no queued SOS is lost
// by the move.
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

export const secureGetItem = async (key: string): Promise<string | null> => {
  if (isNodeRender) return null;
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
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
    // keep the AsyncStorage copy so the value is not lost, and return
    // it — the caller still works, and the plaintext copy is a known
    // fallback, not a silent deletion.
  }
  return legacy;
};

export const secureSetItem = async (key: string, value: string): Promise<void> => {
  if (isNodeRender) return;
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
};

export const secureRemoveItem = async (key: string): Promise<void> => {
  if (isNodeRender) return;
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }
  // Delete from both stores: a pre-M2 plaintext copy must not survive
  // a removal that only cleared the secure one.
  await SecureStore.deleteItemAsync(key).catch(() => {});
  await AsyncStorage.removeItem(key).catch(() => {});
};
