/**
 * Scheduled background refresh of the watchlist and portfolio caches.
 *
 * The OS decides when the task runs (Android WorkManager, iOS
 * BGTaskScheduler via expo-background-task), never more often than
 * {@link BACKGROUND_REFRESH_INTERVAL_MINUTES}. Each run re-checks battery,
 * Low Power Mode and metered-connection constraints itself, because neither
 * platform lets us ask for all of them up front.
 *
 * Results land in the same storage the screens read first — the local
 * watchlist and the `portfolio_summary_<publicKey>` cache entry — so opening
 * the app after a successful run renders without waiting for the network.
 *
 * Failures are never surfaced in the UI; they go to {@link errorReporter}.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Battery from 'expo-battery';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { portfolioApi } from './api';
import { apiClient } from './api-client';
import { cache, CACHE_CONFIGS } from './cache';
import { errorReporter } from './error-reporting';
import { PRIVACY_KEY_PREFIX } from './privacy-preferences';
import { storage } from './storage';
import { syncAndGetWatchlist } from './watchlist';

export const BACKGROUND_REFRESH_TASK = 'lumenpulse-background-refresh';

/** Both platforms enforce a 15-minute floor; 30 keeps battery cost low. */
export const BACKGROUND_REFRESH_INTERVAL_MINUTES = 30;

/** Below this charge, skip unless the device is charging. */
export const MIN_BATTERY_LEVEL = 0.2;

// Under the protected privacy prefix so clearing local data never silently
// turns background refresh back on.
const ENABLED_KEY = `${PRIVACY_KEY_PREFIX}background_refresh_enabled`;

export type SkipReason =
  | 'disabled'
  | 'offline'
  | 'metered'
  | 'low_power_mode'
  | 'low_battery'
  | 'signed_out';

export type BackgroundRefreshOutcome =
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'refreshed'; watchlist: boolean; portfolio: boolean };

export async function isBackgroundRefreshEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== 'false';
  } catch {
    return true;
  }
}

/** Persists the choice and (un)registers the OS task to match. */
export async function setBackgroundRefreshEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, String(enabled));
  await syncBackgroundRefreshRegistration();
}

/**
 * Registers the task when enabled and permitted by the OS, unregisters it
 * otherwise. Safe to call on every launch.
 */
export async function syncBackgroundRefreshRegistration(): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
    const enabled = await isBackgroundRefreshEnabled();
    const available =
      (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;

    if (enabled && available && !registered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
        minimumInterval: BACKGROUND_REFRESH_INTERVAL_MINUTES,
      });
    } else if ((!enabled || !available) && registered) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
    }
  } catch (error) {
    errorReporter.captureError(asError(error), { source: 'background-refresh', step: 'register' });
  }
}

/** Returns why a run must be skipped right now, or null if it may proceed. */
export async function checkRefreshConstraints(): Promise<SkipReason | null> {
  const net = await NetInfo.fetch();
  if (!net.isConnected) return 'offline';
  const details = net.details as { isConnectionExpensive?: boolean } | null | undefined;
  if (details?.isConnectionExpensive) return 'metered';

  const power = await Battery.getPowerStateAsync();
  if (power.lowPowerMode) return 'low_power_mode';
  const charging =
    power.batteryState === Battery.BatteryState.CHARGING ||
    power.batteryState === Battery.BatteryState.FULL;
  // batteryLevel is -1 when unknown (e.g. simulators); don't block on that.
  if (!charging && power.batteryLevel >= 0 && power.batteryLevel < MIN_BATTERY_LEVEL) {
    return 'low_battery';
  }
  return null;
}

/** One background refresh pass. Never throws. */
export async function runBackgroundRefresh(): Promise<BackgroundRefreshOutcome> {
  try {
    if (!(await isBackgroundRefreshEnabled())) return { status: 'skipped', reason: 'disabled' };

    const blocked = await checkRefreshConstraints();
    if (blocked) return { status: 'skipped', reason: blocked };

    // The React tree (and AuthContext) may not be mounted in a background
    // launch, so load the token directly.
    const token = await storage.getAccessToken();
    if (!token) return { status: 'skipped', reason: 'signed_out' };
    apiClient.setAuthToken(token);

    const [watchlist, portfolio] = await Promise.all([refreshWatchlist(), refreshPortfolio()]);
    return { status: 'refreshed', watchlist, portfolio };
  } catch (error) {
    errorReporter.captureError(asError(error), { source: 'background-refresh' });
    return { status: 'refreshed', watchlist: false, portfolio: false };
  }
}

async function refreshWatchlist(): Promise<boolean> {
  try {
    // Same user scoping as WatchlistContext.
    const meta = await storage.getWalletMetadata();
    await syncAndGetWatchlist(meta.activePublicKey || undefined);
    return true;
  } catch (error) {
    errorReporter.captureError(asError(error), {
      source: 'background-refresh',
      target: 'watchlist',
    });
    return false;
  }
}

async function refreshPortfolio(): Promise<boolean> {
  try {
    const publicKey = await storage.getActiveWalletPublicKey();
    if (!publicKey) return false;
    const response = await portfolioApi.getAccountSummary(publicKey);
    if (!response.success || !response.data) {
      throw new Error(response.error?.message || 'Portfolio summary request failed');
    }
    // Key and config must match the portfolio screen's useCachedData call.
    await cache.set(`portfolio_summary_${publicKey}`, response.data, CACHE_CONFIGS.PORTFOLIO);
    return true;
  } catch (error) {
    errorReporter.captureError(asError(error), {
      source: 'background-refresh',
      target: 'portfolio',
    });
    return false;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Task definitions must run at module load, before the OS can invoke the task.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  const outcome = await runBackgroundRefresh();
  return outcome.status === 'refreshed' && !(outcome.watchlist || outcome.portfolio)
    ? BackgroundTask.BackgroundTaskResult.Failed
    : BackgroundTask.BackgroundTaskResult.Success;
});
