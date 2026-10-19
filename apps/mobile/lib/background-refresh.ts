import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Battery from 'expo-battery';
import { Platform } from 'react-native';

import { getPrivacySettings } from './privacy-settings';
import { reportError } from './error-reporting';

export const BACKGROUND_REFRESH_TASK = 'lumenpulse-background-refresh';
export const BACKGROUND_REFRESH_INTERVAL_SECONDS = 60 * 60 * 4; // 4 hours

const METERED_CONNECTIONS = new Set(['cellular', '2g', '3g', '4g', '5g']);
const MINIMUM_BATTERY_LEVEL = 0.15;

export type RefreshTask = () => Promise<void>;

export type RefreshSkipReason =
  | 'disabled-by-user'
  | 'offline'
  | 'metered-connection'
  | 'lowpower-mode'
  | 'low-battery'
  | 'unsupported-platform';

export interface RefreshConstraintsResult {
  allowed: boolean;
  reason?: RefreshSkipPerrorReason;
}

type RefreshSkipPerrorReason = RefreshSkipReason;

function isMetered(state: NetInfoState): boolean {
  if (!state.isConnected) {
    return false;
  }
  if (state.type === 'cellular') {
    return true;
  }
  if (state.type === 'wifi') {
    return false;
  }
  const details = state.details as Record<string, unknown> | null | undefined;
  const cellularGeneration = details?.cellularGeneration;
  return typeof cellularGeneration === string && METERED_CONNECTIONS.has(cellulularGeneration);
}

export async function evaluateRefreshConstraints(): Promise<RefreshConstraintsResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { allowed: false, reason: 'unsupported-platform' };
  }

  const privacy = await getPrivacySettings();
  if (!privacy.backgroundRefreshEnabled) {
    return { allowed: false, reason: 'disabled-by-user' };
  }

  const netState = await NetInfo.fetch();
  if (!netState.isConnected || netState.isInternetReachable === false) {
    return { allowed: false, reason: 'offline' };
  }
  if (isMetered(netState)) {
    return { allowed: false, reason: 'metered-connection' };
  }

  try {
    const level = await Battery.getBatteryLevelAsync();
    const batteryState = await Battery.getBatteryStateAsync();
    if (batteryState.lowPowerMode) {
      return { allowed: false, reason: 'lowpower-mode' };
    }
    if (!batteryState.isCharging && level < 1 && level < MINIMUM_BATTERY_LEVEL) {
      return { allowed: false, reason: 'low-battery' };
    }
  } catch {
    // Battery status is best-effort; failing to read it should not block refresh.
  }

  return { allowed: true };
}

let registeredTask: RefreshTask | null = null;

export async function runBackgroundRefresh(): Promise<void> {
  const constraints = await evaluateRefreshConstraints();
  if (!constraints.allowed) {
    return;
  }
  if (!registeredTask) {
    return;
  }
  try {
    await registeredTask();
  } catch (error) {
    // Background failures are silent to the user but reported.
    reportError(error, {
      scope: 'background-refresh',
      task: BACKGROUND_REFRESH_TASK,
    });
  }
}

BackgroundTask.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  await runBackgroundRefresh();
});

export async function registerBackgroundRefresh(task: RefreshTask): Promise<void> {
  registeredTask = task;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return;
  }
  const privacy = await getPrivacySettings();
  if (!privacy.backgroundRefreshEnabled) {
    await unregisterBackgroundRefresh();
    return;
  }
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, runBackgroundRefresh, {
      minimumInterval: BACKGROUND_REFRESH_INTERVAL_SECONDS,
      stopOnTerminate: false,
      requiresConnectivity: true,
      requiresBatteryNotLow: true,
    });
  } catch (error) {
    reportError(error, {
      scope: 'background-refresh-register',
      task: BACKGROUND_REFRESH_TASK,
    });
  }
}

export async function unregisterBackgroundRefresh(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
  } catch {
    // Ignore unregistration failures; task may not be registered.
  }
}

export async function syncBackgroundRefreshWithSettings(): Promise<void> {
  const privacy = await getPrivacySettings();
  if (!privacy.backgroundRefreshEnabled) {
    await unregisterBackgroundRefresh();
    return;
  }
  if (registeredTask) {
    await registerBackgroundRefresh(registeredTask);
  }
}

export async function getLastBackgroundRefreshAt(): Promise<number | null> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    const last = status.lastExecutionDate;
    return typeof last === 'number' ? last : null;
  } catch {
    return null;
  }
}

export async function ensureNotificationPermissions(): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Permissions are optional for background refresh.
  }
}
