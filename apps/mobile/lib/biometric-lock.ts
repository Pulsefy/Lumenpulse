import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from './secure-storage';
import { Platform } from 'react-native';
import { config } from './config';

const BIOMETRIC_LOCK_ENABLED_KEY = 'biometric_lock_enabled';
const INACTIVITY_TIMEOUT_KEY = 'session_inactivity_timeout_ms';

// Documented bounds for the user-configurable inactivity timeout.
export const MIN_INACTIVITY_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const MAX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Threshold for backgrounding that triggers a lock on return.
export const BACKGROUND_LOCK_THRESHOLD_MS = 30 * 1000; // 30 seconds

export function clampInactivityTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_INACTIVITY_TIMEOUT_MS;
  }
  return Math.min(MAX_INACTIVITY_TIMEOUT_MS, Math.max(MIN_INACTIVITY_TIMEOUT_MS, Math.round(timeoutMs)));
}

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

export async function getInactivityTimeout(): Promise<number> {
  try {
    const value = await SecureStore.getItemAsync(INACTIVITY_TIMEOUT_KEY);
    if (!value) {
      return DEFAULT_INACTIVITY_TIMEOUT_MS;
    }
    const parsed = Number.parseInt(value, 10);
    return clampInactivityTimeout(parsed);
  } catch (error) {
    console.error('Error reading inactivity timeout:', error);
    return DEFAULT_INACTIVITY_TIMEOUT_MS;
  }
}

export async function setInactivityTimeout(timeoutMs: number): Promise<void> {
  const clamped = clampInactivityTimeout(timeoutMs);
  try {
    await SecureStore.setItemAsync(INACTIVITY_TIMEOUT_KEY, String(clamped));
  } catch (error) {
    console.error('Error saving inactivity timeout:', error);
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

// -----------------------------------------------------------------------------
// Session inactivity / re-authentication policy
// -----------------------------------------------------------------------------

export interface SessionLockState {
  locked: boolean;
  lastActivityAt: number;
  backgroundedAt: number | null;
  inactivityTimeoutMs: number;
}

let sessionState: SessionLockState = {
  locked: false,
  lastActivityAt: Date.now(),
  backgroundedAt: null,
  inactivityTimeoutMs: DEFAULT_INACTIVITY_TIMEOUT_MS,
};

export function getSessionLockState(): SessionLockState {
  return { ...sessionState };
}

export function resetSessionLockState(): void {
  sessionState = {
    locked: false,
    lastActivityAt: Date.now(),
    backgroundedAt: null,
    inactivityTimeoutMs: sessionState.inactivityTimeoutMs,
  };
}

export async function configureSessionTimeout(timeoutMs: number): Promise<void> {
  const clamped = clampInactivityTimeout(timeoutMs);
  sessionState.inactivityTimeoutMs = clamped;
  await setInactivityTimeout(clamped);
}

/**
 * Records user activity. Should be called on interactions while the app is foreground.
 */
export function recordActivity(now: number = Date.now()): void {
  if (sessionState.locked) return;
  sessionState.lastActivityAt = now;
}

/**
 * Returns true if the session should be locked due to inactivity.
 */
export function isSessionExpired(now: number = Date.now()): boolean {
  if (sessionState.locked) return true;
  return now - sessionState.lastActivityAt >= sessionState.inactivityTimeoutMs;
}

/**
 * Marks the session as locked. Unsaved input is preserved because locking only gates the UI and
 * does not clear state or storage.
 */
export function lockSession(): void {
  sessionState.locked = true;
}

/**
 * Attempts to unlock the session via re-authentication. Returns true on success.
 */
export async function unlockSession(
  promptOverride?: string,
  now: number = Date.now(),
): Promise<boolean> {
  const prompt = promptOverride ?? 'Unlock to continue';

  if (Platform.OS === 'web') {
    sessionState.locked = false;
    sessionState.lastActivityAt = now;
    sessionState.backgroundedAt = null;
    return true;
  }

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      sessionState.locked = false;
      sessionState.lastActivityAt = now;
      sessionState.backgroundedAt = null;
      lastSuccessfulAuthenticationTime = now;
      return true;
    }

    return false;
  } catch (error) {
    console.warn('Unlock authentication error:', error);
    return false;
  }
}

/**
 * Handles app backgrounding. Records time so the lock threshold can be enforced on return.
 */
export function handleAppBackgrounded(now: number = Date.now()): void {
  sessionState.backgroundedAt = now;
}

/**
 * Handles app returning to the foreground. Locks the session if the app was backgrounded longer than
 * the threshold or if the inactivity timeout has elapsed. Returns true if the session is now locked.
 */
export function handleAppForegrounded(now: number = Date.now()): boolean {
  if (sessionState.locked) {
    sessionState.backgroundedAt = null;
    return true;
  }

  const backgroundedAt = sessionState.backgroundedAt;
  sessionState.backgroundedAt = null;

  if (backgroundedAt !== null && now - backgroundedAt >= BACKGROUND_LOCK_THRESHOLD_MS) {
    lockSession();
    return true;
  }

  if (isSessionExpired(now)) {
    lockSession();
    return true;
  }

  return false;
}
