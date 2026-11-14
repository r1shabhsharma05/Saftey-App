// Biometric app lock — preference + capability checks + the unlock
// prompt. The lock itself is enforced in app/_layout.tsx (prompt on
// launch / foreground); this file owns the shared logic so the
// Profile toggle and the layout never disagree.
//
// Never locks the user out: if the device has no biometric hardware
// or nothing enrolled, the toggle reports unavailable and the layout
// skips the prompt. The preference lives in secure storage.
import * as LocalAuthentication from 'expo-local-authentication';
import { secureGetItem, secureSetItem, secureRemoveItem } from './secureStorage';

const KEY = 'biometric_lock_enabled';

export const isBiometricLockEnabled = async (): Promise<boolean> =>
  (await secureGetItem(KEY)) === '1';

export const setBiometricLockEnabled = async (enabled: boolean): Promise<void> => {
  if (enabled) await secureSetItem(KEY, '1');
  else await secureRemoveItem(KEY);
};

// Last successful unlock (ms since epoch). The layout ignores the
// AppState 'active' event that fires when the system biometric prompt
// itself dismisses — without this, every successful unlock re-arms
// the lock and the prompt loops forever.
let lastUnlockedAt = 0;
export const markUnlocked = (): void => {
  lastUnlockedAt = Date.now();
};
export const recentlyUnlocked = (windowMs = 10000): boolean =>
  Date.now() - lastUnlockedAt < windowMs;

// When the app last went to background (ms since epoch). A quick
// switch away (e.g. reading the OTP SMS) must not re-lock; only a
// longer absence re-arms. Never backgrounded = treated as long ago.
let backgroundedAt = 0;
export const noteBackgrounded = (): void => {
  backgroundedAt = Date.now();
};
export const backgroundedForMs = (): number =>
  backgroundedAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - backgroundedAt;

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
}

export const getBiometricCapability = async (): Promise<BiometricCapability> => {
  const hasHardware = await LocalAuthentication.hasHardwareAsync().catch(() => false);
  const isEnrolled = hasHardware
    ? await LocalAuthentication.isEnrolledAsync().catch(() => false)
    : false;
  return { hasHardware, isEnrolled };
};

/** One unlock attempt: biometrics, falling back to device credentials. */
export const authenticateForUnlock = async (): Promise<boolean> => {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock SafeLife',
    fallbackLabel: 'Use device passcode',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  }).catch(() => ({ success: false }));
  if (result.success) markUnlocked();
  return result.success;
};
