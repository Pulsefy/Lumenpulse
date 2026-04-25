import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter } from 'react-native';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  staleWhileRevalidate?: boolean; // Return stale data while fetching fresh
  maxAge?: number; // Maximum age before data is considered invalid
}

export class CacheManager {
  private static instance: CacheManager;
  private isOnline: boolean = true;
  private refreshQueue: Set<string> = new Set();

  private constructor() {
    this.initNetworkListener();
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  private initNetworkListener() {
    NetInfo.addEventListener((state) => {
      const wasOffline = !this.isOnline;
      this.isOnline = state.isConnected ?? false;

      // When connectivity returns, process refresh queue
      if (wasOffline && this.isOnline) {
        this.processRefreshQueue();
      }
    });
  }

  private async processRefreshQueue() {
    const keys = Array.from(this.refreshQueue);
    this.refreshQueue.clear();

    // Process queued refreshes with delay to avoid overwhelming the API
    for (const key of keys) {
      setTimeout(() => {
        this.triggerRefresh(key);
      }, Math.random() * 2000); // Random delay up to 2 seconds
    }
  }

  private triggerRefresh(key: string) {
    // Emit custom event for components to listen to
    DeviceEventEmitter.emit('cache-refresh', { key });
  }

  async get<T>(key: string, config: CacheConfig): Promise<CacheEntry<T> | null> {
    try {
      const cached = await AsyncStorage.getItem(`cache_${key}`);
      if (!cached) return null;

      const entry: CacheEntry<T> = JSON.parse(cached);
      const now = Date.now();

      // Check if data is expired
      if (now > entry.expiresAt) {
        await this.remove(key);
        return null;
      }

      // Check if data is stale but still usable
      const isStale = now > entry.timestamp + config.ttl;
      if (isStale && config.staleWhileRevalidate && this.isOnline) {
        // Queue for background refresh
        this.refreshQueue.add(key);
        setTimeout(() => this.triggerRefresh(key), 100);
      }

      return entry;
    } catch (error) {
      console.warn('Cache get error:', error);
      return null;
    }
  }

  async set<T>(key: string, data: T, config: CacheConfig): Promise<void> {
    try {
      const now = Date.now();
      const maxAge = config.maxAge || config.ttl * 3; // Default max age is 3x TTL

      const entry: CacheEntry<T> = {
        data,
        timestamp: now,
        expiresAt: now + maxAge,
      };

      await AsyncStorage.setItem(`cache_${key}`, JSON.stringify(entry));
    } catch (error) {
      console.warn('Cache set error:', error);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`cache_${key}`);
    } catch (error) {
      console.warn('Cache remove error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((key) => key.startsWith('cache_'));
      await AsyncStorage.multiRemove(cacheKeys);
    } catch (error) {
      console.warn('Cache clear error:', error);
    }
  }

  isOnlineStatus(): boolean {
    return this.isOnline;
  }
}

// Cache configurations for different data types
export const CACHE_CONFIGS = {
  PORTFOLIO: {
    ttl: 5 * 60 * 1000, // 5 minutes
    staleWhileRevalidate: true,
    maxAge: 30 * 60 * 1000, // 30 minutes max
  },
  NEWS: {
    ttl: 10 * 60 * 1000, // 10 minutes
    staleWhileRevalidate: true,
    maxAge: 2 * 60 * 60 * 1000, // 2 hours max
  },
  ASSETS: {
    ttl: 15 * 60 * 1000, // 15 minutes
    staleWhileRevalidate: true,
    maxAge: 60 * 60 * 1000, // 1 hour max
  },
  TRANSACTIONS: {
    ttl: 2 * 60 * 1000, // 2 minutes
    staleWhileRevalidate: true,
    maxAge: 15 * 60 * 1000, // 15 minutes max
  },
} as const;

export const cache = CacheManager.getInstance();
