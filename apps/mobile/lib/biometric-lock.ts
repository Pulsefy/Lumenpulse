import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BIOMETRIC_LOCK_ENABLED_KEY = 'biometric_lock_enabled';

export async function getBiometricLockEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_LOCK_ENABLED_KEY);
    return value === 'true';
  } catch (error) {
    console.error('Error reading biometric lock preference:', error);
    return false;
  }
}

export async function setBiometricLockEnabled(enabled: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(BIOMETRIC_LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('Error saving biometric lock preference:', error);
    throw error;
  }
}

export async function isBiometricLockSupported(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) {
    return false;
  }

  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return supportedTypes.length > 0;
}

export async function isBiometricEnrolled(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }

  return LocalAuthentication.isEnrolledAsync();
}

export async function authenticateBiometricPrompt(
  promptMessage = 'Authenticate to continue',
): Promise<LocalAuthentication.LocalAuthenticationResult> {
  return LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
    disableDeviceFallback: false,
  });
}

/**
 * Requires biometric confirmation if supported and enrolled.
 * Returns true if the user successfully authenticates or if biometrics are not supported/enrolled.
 * Returns false if the user cancels or authentication fails.
 */
export async function requireBiometricConfirmation(promptMessage: string): Promise<boolean> {
  try {
    const supported = await isBiometricLockSupported();
    if (!supported) return true;

    const enrolled = await isBiometricEnrolled();
    if (!enrolled) return true;

    const result = await authenticateBiometricPrompt(promptMessage);
    return result.success;
  } catch (error) {
    console.warn('Biometric confirmation error:', error);
    // Fail safe to not block action if there's a system error, but wait, usually we should return false?
    // "Failure and cancel states keep the underlying action safe."
    // If it errors, we probably shouldn't allow it. Or allow it if hardware fails? Let's return false on error.
    return false;
  }
}
