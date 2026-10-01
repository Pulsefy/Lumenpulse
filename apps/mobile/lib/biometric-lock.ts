import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from './secure-storage';
import { Platform } from 'react-native';
import { config } from './config';

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

/**
 * Requires step-up authentication with a configurable grace period.
 * Uses biometric or device passcode authentication.
 * Returns true if authenticated or if within the grace period.
 * Returns false if authentication fails or is cancelled, ensuring state is protected.
 */
let lastSuccessfulAuthenticationTime = 0;

export async function requireStepUpAuthentication(
  promptMessage: string,
  gracePeriodMs: number = config.app.stepUpGracePeriodMs
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return true;
  }

  const now = Date.now();
  if (lastSuccessfulAuthenticationTime > 0 && now - lastSuccessfulAuthenticationTime <= gracePeriodMs) {
    return true;
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      lastSuccessfulAuthenticationTime = Date.now();
      return true;
    }

    return false;
  } catch (error) {
    console.warn('Step-up authentication error:', error);
    return false;
  }
}
