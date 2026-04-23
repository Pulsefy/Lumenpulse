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
