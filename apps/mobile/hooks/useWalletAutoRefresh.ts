import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { cache } from '../lib/cache';

export interface WalletAutoRefreshOptions {
  /** How often to attempt a refresh while the app is active (ms). */
  intervalMs: number;
  /** Called when the interval fires and conditions are met. Must be stable (useCallback). */
  onRefresh: () => void | Promise<void>;
  /** Pass false to disable (e.g. user is not authenticated). */
  enabled?: boolean;
}

/**
 * Runs `onRefresh` on a bounded interval only while the app is in the
 * foreground and the device is online.  Stops ticking when the app goes
 * to the background, preventing battery drain.
 *
 * Error handling is left to the caller — a thrown error from `onRefresh`
 * will be caught here and silently suppressed so foreground UI is not
 * affected by a background refresh failure.
 */
export function useWalletAutoRefresh({
  intervalMs,
  onRefresh,
  enabled = true,
}: WalletAutoRefreshOptions): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Keep a stable ref to the latest callback so the interval closure never
  // captures a stale version without needing to restart the interval.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;

    const startInterval = () => {
      if (timerRef.current !== null) return; // already running
      timerRef.current = setInterval(() => {
        // Only refresh when online; offline state is handled by useCachedData
        if (!cache.isOnlineStatus()) return;
        Promise.resolve()
          .then(() => onRefreshRef.current())
          .catch(() => {
            // Silently swallow background refresh errors — foreground
            // error states are owned by the individual data hooks.
          });
      }, intervalMs);
    };

    const stopInterval = () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    // Start immediately if already active
    if (appStateRef.current === 'active') {
      startInterval();
    }

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        startInterval();
      } else {
        stopInterval();
      }
    });

    return () => {
      stopInterval();
      subscription.remove();
    };
  }, [enabled, intervalMs]);
}
