import * as SecureStore from './secure-storage';
import { AppState, AppStateStatus } from 'react-native';
import { config } from './config';

const SESSION_TIMEOUT_KEY = 'session_timeout_ms';

/**
 * Documented bounds for the configurable inactivity timeout.
 * Users may adjust the timeout within these limits.
 */
export const MIN_SESSION_TIMEOUT_MS = 30 * 1000; // 30 seconds
export const MAX_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Threshold for backgrounding. If the app is backgrounded for longer than
 * this threshold, the app locks on return regardless of inactivity timer.
 */
export const BACKGROUND_LOCK_THRESHOLD_MS = 30 * 1000; // 30 seconds

export interface SessionTimeoutPolicy {
  /** Inactivity timeout in milliseconds. */
  inactivityTimeoutMs: number;
  /** Backgrounding duration that triggers a lock on return. */
  backgroundLockThresholdMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionTimeoutPolicy = {
  inactivityTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
  backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
};

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SESSION_TIMEOUT_MS;
  if (value < MIN_SESSION_TIMEOUT_MS) return MIN_SESSION_TIMEOUT_MS;
  if (value > MAX_SESSION_TIMEOUT_MS) return MAX_SESSION_TIMEOUT_MS;
  return Math.round(value);
}

export async function getSessionTimeoutMs(): Promise<number> {
  try {
    const value = await SecureStore.getItemAsync(SESSION_TIMEOUT_KEY);
    if (!value) return DEFAULT_SESSION_TIMEOUT_MS;
    const parsed = Number(value);
    return clampTimeout(parsed);
  } catch (error) {
    console.error('Error reading session timeout preference:', error);
    return DEFAULT_SESSION_TIMEOUT_MS;
  }
}

export function clampInactivityTimeout(value: number): number {
  return clampTimeout(value);
}

export async function setSessionTimeoutMs(timeoutMs: number): Promise<void> {
  const clamped = clampTimeout(timeoutMs);
  try {
    await SecureStore.setItemAsync(SESSION_TIMEOUT_KEY, String(clamped));
  } catch (error) {
    console.error('Error saving session timeout preference:', error);
    throw error;
  }
}

export async function getSessionTimeoutPolicy(): Promise<SessionTimeoutPolicy> {
  const inactivityTimeoutMs = await getSessionTimeoutMs();
  return {
    inactivityTimeoutMs,
    backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
  };
}

/**
 * Tracks the last user activity timestamp and determines whether the session
 * should be locked due to inactivity or prolonged backgrounding.
 */
export class SessionTimeoutManager {
  private lastActivityTime: number;
  private backgroundedAt: number | null = null;
  private inactivityTimeoutMs: number;
  private backgroundLockThresholdMs: number;
  private locked = false;
  private listeners = new Set<() => void>();
  private appStateSubscription: { remove: () => void } | null = null;

  constructor(policy: SessionTimeoutPolicy = DEFAULT_SESSION_POLICY) {
    this.lastActivityTime = Date.now();
    this.inactivityTimeoutMs = clampTimeout(policy.inactivityTimeoutMs);
    this.backgroundLockThresholdMs = policy.backgroundLockThresholdMs;
  }

  getPolicy(): SessionTimeoutPolicy {
    return {
      inactivityTimeoutMs: this.inactivityTimeoutMs,
      backgroundLockThresholdMs: this.backgroundLockThresholdMs,
    };
  }

  setPolicy(policy: Partial<SessionTimeoutPolicy>): void {
    if (typeof policy.inactivityTimeoutMs === 'number') {
      this.inactivityTimeoutMs = clampTimeout(policy.inactivityTimeoutMs);
    }
    if (typeof policy.backgroundLockThresholdMs === 'number') {
      this.backgroundLockThresholdMs = policy.backgroundLockThresholdMs;
    }
  }

  /** Record user activity, resetting the inactivity timer. */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /** Mark the session as locked. */
  lock(): void {
    if (this.locked) return;
    this.locked = true;
    this.notifyListeners();
  }

  /** Mark the session as unlocked and reset the inactivity timer. */
  unlock(): void {
    this.locked = false;
    this.lastActivityTime = Date.now();
    this.backgroundedAt = null;
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Returns true if the inactivity timeout has elapsed. */
  isInactivityTimeoutElapsed(): boolean {
    return Date.now() - this.lastActivityTime >= this.inactivityTimeoutMs;
  }

  /**
   * Evaluates whether the session should be locked based on inactivity or the
   * duration the app was backgrounded. If so, it locks and returns true.
   */
  evaluate(): boolean {
    const now = Date.now();
    if (this.backgroundedAt != null) {
      const backgroundDuration = now - this.backgroundedAt;
      if (backgroundDuration >= this.backgroundLockThresholdMs) {
        this.lock();
        return true;
      }
    }
    if (this.isInactivityTimeoutElapsed()) {
      this.lock();
      return true;
    }
    return this.locked;
  }

  /** Handle app state changes to track backgrounding. */
  handleAppStateChange(nextState: AppStateStatus): void {
    if (nextState === 'background' || nextState === 'inactive') {
      if (this.backgroundedAt == null) {
        this.backgroundedAt = Date.now();
      }
      return;
    }
    if (nextState === 'active') {
      this.evaluate();
      this.backgroundedAt = null;
    }
  }

  /** Subscribe to app state changes to enforce the background lock policy. */
  attachAppStateListener(): void {
    if (this.appStateSubscription) return;
    this.appStateSubscription = AppState.addEventListener('change', (status) => this.handleAppStateChange(status));
  }

  detachAppStateListener(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /** Subscribe to lock events. Returns an unsubscribe function. */
  onLock(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        console.warn('Session timeout listener error:', error);
      }
    }
  }

  /** Reset all internal state. Useful for testing and on logout. */
  reset(): void {
    this.lastActivityTime = Date.now();
    this.backgroundedAt = null;
    this.locked = false;
  }
}

export const sessionTimeoutManager = new SessionTimeoutManager({
  inactivityTimeoutMs: config.app.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
  backgroundLockThresholdMs: BACKGROUND_LOCK_THRESHOLD_MS,
});
