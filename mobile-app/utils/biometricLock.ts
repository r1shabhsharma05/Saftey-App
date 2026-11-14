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
  return result.success;
};
