import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Battery from 'expo-battery';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { portfolioApi } from '../api';
import { apiClient } from '../api-client';
import { cache, CACHE_CONFIGS } from '../cache';
import { errorReporter } from '../error-reporting';
import { storage } from '../storage';
import { syncAndGetWatchlist } from '../watchlist';
import {
  BACKGROUND_REFRESH_INTERVAL_MINUTES,
  BACKGROUND_REFRESH_TASK,
  isBackgroundRefreshEnabled,
  runBackgroundRefresh,
  setBackgroundRefreshEnabled,
  syncBackgroundRefreshRegistration,
} from '../background-refresh';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('../api', () => ({ portfolioApi: { getAccountSummary: jest.fn() } }));
jest.mock('../api-client', () => ({ apiClient: { setAuthToken: jest.fn() } }));
jest.mock('../cache', () => ({
  cache: { set: jest.fn() },
  CACHE_CONFIGS: { PORTFOLIO: { ttl: 300000 } },
}));
jest.mock('../storage', () => ({
  storage: {
    getAccessToken: jest.fn(),
    getWalletMetadata: jest.fn(),
    getActiveWalletPublicKey: jest.fn(),
  },
}));
jest.mock('../watchlist', () => ({ syncAndGetWatchlist: jest.fn() }));

const ENABLED_KEY = 'lumenpulse.privacy.background_refresh_enabled';
const PK = 'GABC';

const m = <T>(fn: T) => fn as unknown as jest.Mock;

// Captured before beforeEach clears mocks: defineTask runs at module load.
const [definedName, taskFn] = m(TaskManager.defineTask).mock.calls[0] as [
  string,
  () => Promise<BackgroundTask.BackgroundTaskResult>,
];

let stored: Record<string, string> = {};

beforeEach(() => {
  jest.clearAllMocks();
  stored = {};
  m(AsyncStorage.getItem).mockImplementation(async (k: string) => stored[k] ?? null);
  m(AsyncStorage.setItem).mockImplementation(async (k: string, v: string) => {
    stored[k] = v;
  });
  m(NetInfo.fetch).mockResolvedValue({
    isConnected: true,
    details: { isConnectionExpensive: false },
  });
  m(Battery.getPowerStateAsync).mockResolvedValue({
    batteryLevel: 0.8,
    batteryState: Battery.BatteryState.UNPLUGGED,
    lowPowerMode: false,
  });
  m(BackgroundTask.getStatusAsync).mockResolvedValue(BackgroundTask.BackgroundTaskStatus.Available);
  m(TaskManager.isTaskRegisteredAsync).mockResolvedValue(false);
  m(storage.getAccessToken).mockResolvedValue('token');
  m(storage.getWalletMetadata).mockResolvedValue({ activePublicKey: PK });
  m(storage.getActiveWalletPublicKey).mockResolvedValue(PK);
  m(syncAndGetWatchlist).mockResolvedValue({
    items: [],
    localOnly: 0,
    conflicts: [],
    rollbacks: [],
  });
  m(portfolioApi.getAccountSummary).mockResolvedValue({ success: true, data: { total: 1 } });
  jest.spyOn(errorReporter, 'captureError').mockImplementation(() => undefined);
});

describe('runBackgroundRefresh', () => {
  it('refreshes the watchlist and writes the portfolio cache the screen reads', async () => {
    await expect(runBackgroundRefresh()).resolves.toEqual({
      status: 'refreshed',
      watchlist: true,
      portfolio: true,
    });
    expect(apiClient.setAuthToken).toHaveBeenCalledWith('token');
    expect(syncAndGetWatchlist).toHaveBeenCalledWith(PK);
    expect(cache.set).toHaveBeenCalledWith(
      `portfolio_summary_${PK}`,
      { total: 1 },
      CACHE_CONFIGS.PORTFOLIO,
    );
  });

  it.each([
    ['disabled', () => (stored[ENABLED_KEY] = 'false')],
    ['offline', () => m(NetInfo.fetch).mockResolvedValue({ isConnected: false })],
    [
      'metered',
      () =>
        m(NetInfo.fetch).mockResolvedValue({
          isConnected: true,
          details: { isConnectionExpensive: true },
        }),
    ],
    [
      'low_power_mode',
      () =>
        m(Battery.getPowerStateAsync).mockResolvedValue({
          batteryLevel: 0.9,
          batteryState: Battery.BatteryState.UNPLUGGED,
          lowPowerMode: true,
        }),
    ],
    [
      'low_battery',
      () =>
        m(Battery.getPowerStateAsync).mockResolvedValue({
          batteryLevel: 0.1,
          batteryState: Battery.BatteryState.UNPLUGGED,
          lowPowerMode: false,
        }),
    ],
    ['signed_out', () => m(storage.getAccessToken).mockResolvedValue(null)],
  ])('skips without network calls when %s', async (reason, arrange) => {
    arrange();
    await expect(runBackgroundRefresh()).resolves.toEqual({ status: 'skipped', reason });
    expect(syncAndGetWatchlist).not.toHaveBeenCalled();
    expect(portfolioApi.getAccountSummary).not.toHaveBeenCalled();
  });

  it('runs on low battery while charging', async () => {
    m(Battery.getPowerStateAsync).mockResolvedValue({
      batteryLevel: 0.1,
      batteryState: Battery.BatteryState.CHARGING,
      lowPowerMode: false,
    });
    await expect(runBackgroundRefresh()).resolves.toMatchObject({ status: 'refreshed' });
  });

  it('reports failures to error reporting without throwing', async () => {
    m(syncAndGetWatchlist).mockRejectedValue(new Error('watchlist down'));
    m(portfolioApi.getAccountSummary).mockResolvedValue({
      success: false,
      error: { message: '503' },
    });

    await expect(runBackgroundRefresh()).resolves.toEqual({
      status: 'refreshed',
      watchlist: false,
      portfolio: false,
    });
    expect(cache.set).not.toHaveBeenCalled();
    expect(errorReporter.captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'background-refresh',
      target: 'watchlist',
    });
    expect(errorReporter.captureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '503' }),
      {
        source: 'background-refresh',
        target: 'portfolio',
      },
    );
  });
});

describe('task', () => {
  it('is defined under the registered name and reports success or failure to the OS', async () => {
    expect(definedName).toBe(BACKGROUND_REFRESH_TASK);
    await expect(taskFn()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Success);
    m(syncAndGetWatchlist).mockRejectedValue(new Error('x'));
    m(portfolioApi.getAccountSummary).mockRejectedValue(new Error('y'));
    await expect(taskFn()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Failed);
  });
});

describe('registration', () => {
  it('defaults to enabled', async () => {
    await expect(isBackgroundRefreshEnabled()).resolves.toBe(true);
  });

  it('registers with the platform-safe interval when enabled', async () => {
    await syncBackgroundRefreshRegistration();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK, {
      minimumInterval: BACKGROUND_REFRESH_INTERVAL_MINUTES,
    });
    expect(BACKGROUND_REFRESH_INTERVAL_MINUTES).toBeGreaterThanOrEqual(15);
  });

  it('unregisters when the user disables it', async () => {
    m(TaskManager.isTaskRegisteredAsync).mockResolvedValue(true);
    await setBackgroundRefreshEnabled(false);
    expect(stored[ENABLED_KEY]).toBe('false');
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith(BACKGROUND_REFRESH_TASK);
  });

  it('does not register when the OS restricts background tasks', async () => {
    m(BackgroundTask.getStatusAsync).mockResolvedValue(
      BackgroundTask.BackgroundTaskStatus.Restricted,
    );
    await syncBackgroundRefreshRegistration();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('reports registration errors silently', async () => {
    m(BackgroundTask.registerTaskAsync).mockRejectedValue(new Error('denied'));
    await expect(syncBackgroundRefreshRegistration()).resolves.toBeUndefined();
    expect(errorReporter.captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'background-refresh',
      step: 'register',
    });
  });
});
