import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getAllKeys: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

jest.mock('react-native', () => ({
  DeviceEventEmitter: { emit: jest.fn() },
}));

import { CacheManager, cache } from '../cache';

describe('CacheManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (NetInfo.addEventListener as jest.Mock).mockImplementation((listener) => {
      listener({ isConnected: true });
    });
  });

  it('stores and reads a cached value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({
      data: { hello: 'world' },
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000,
    }));

    const value = await cache.get('demo', { ttl: 1000, staleWhileRevalidate: false });

    expect(value).not.toBeNull();
    expect(value?.data).toEqual({ hello: 'world' });
  });

  it('removes expired entries', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({
      data: 'expired',
      timestamp: Date.now() - 100000,
      expiresAt: Date.now() - 1,
    }));

    const value = await cache.get('expired', { ttl: 1000, staleWhileRevalidate: false });

    expect(value).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('cache_expired');
  });

  it('clears cache keys without touching unrelated data', async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue(['cache_portfolio', 'notes']);

    await cache.clear();

    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['cache_portfolio']);
  });

  it('tracks online status', () => {
    expect(cache.isOnlineStatus()).toBe(true);
  });

  it('emits a refresh event when stale data is allowed to revalidate', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({
      data: { value: 1 },
      timestamp: Date.now() - 60000,
      expiresAt: Date.now() + 60000,
    }));

    await cache.get('stale', { ttl: 1000, staleWhileRevalidate: true });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith('cache-refresh', { key: 'stale' });
  });
});
