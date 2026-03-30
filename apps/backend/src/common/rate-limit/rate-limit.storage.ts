import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { getRateLimitSettings } from './rate-limit.config';

interface RateLimitEntry {
  totalHits: number;
  expiresAt: number;
  blockedUntil: number;
}

interface AppRateLimitStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RateLimitStorageService
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RateLimitStorageService.name);
  private readonly store: Keyv<RateLimitEntry>;

  constructor() {
    const settings = getRateLimitSettings();
    const useRedis = Boolean(settings.redisUrl);

    this.store = useRedis
      ? new Keyv<RateLimitEntry>({
          store: new KeyvRedis(settings.redisUrl),
          namespace: settings.redisNamespace,
        })
      : new Keyv<RateLimitEntry>({
          namespace: settings.redisNamespace,
        });

    this.store.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rate limit storage error: ${message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<AppRateLimitStorageRecord> {
    void throttlerName;

    const now = Date.now();
    const cachedEntry = await this.store.get(key);
    const baseEntry =
      cachedEntry && cachedEntry.expiresAt > now
        ? cachedEntry
        : {
            totalHits: 0,
            expiresAt: now + ttl,
            blockedUntil: 0,
          };

    if (baseEntry.blockedUntil > now) {
      await this.persistEntry(key, baseEntry, now);
      return this.toRecord(baseEntry, now);
    }

    const updatedEntry: RateLimitEntry = {
      ...baseEntry,
      totalHits: baseEntry.totalHits + 1,
    };

    if (updatedEntry.totalHits > limit) {
      updatedEntry.blockedUntil = now + blockDuration;
    }

    await this.persistEntry(key, updatedEntry, now);
    return this.toRecord(updatedEntry, now);
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.disconnect();
  }

  private async persistEntry(
    key: string,
    entry: RateLimitEntry,
    now: number,
  ): Promise<void> {
    const ttlMs = Math.max(entry.expiresAt - now, entry.blockedUntil - now, 1);
    await this.store.set(key, entry, ttlMs);
  }

  private toRecord(entry: RateLimitEntry, now: number): AppRateLimitStorageRecord {
    const timeToExpire = Math.max(Math.ceil((entry.expiresAt - now) / 1000), 0);
    const timeToBlockExpire = Math.max(
      Math.ceil((entry.blockedUntil - now) / 1000),
      0,
    );

    return {
      totalHits: entry.totalHits,
      timeToExpire,
      isBlocked: entry.blockedUntil > now,
      timeToBlockExpire,
    };
  }
}
