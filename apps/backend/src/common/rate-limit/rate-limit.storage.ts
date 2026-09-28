import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';
import { getRateLimitSettings } from './rate-limit.config';

/**
 * Optional DI token for supplying a pre-built Keyv store (e.g. an in-memory
 * store in tests). When absent, Redis is used if configured, else memory.
 */
export const RATE_LIMIT_KEYV_STORE = Symbol('RATE_LIMIT_KEYV_STORE');

export interface RateLimitEntry {
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

  constructor(
    @Optional()
    @Inject(RATE_LIMIT_KEYV_STORE)
    store?: Keyv<RateLimitEntry>,
  ) {
    const settings = getRateLimitSettings();
    const useRedis = Boolean(settings.redisUrl);

    this.store = store
      ? store
      : useRedis
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

    // An active block must be honoured for its full duration even when it
    // outlives the counting window (e.g. auth: ttl=60s, blockDuration=300s);
    // otherwise the advertised Retry-After would be wrong and the block would
    // silently lapse when the window rolled over.
    if (cachedEntry && cachedEntry.blockedUntil > now) {
      return this.toRecord(cachedEntry, now);
    }

    // Start a fresh window when there is no entry, the window has elapsed, or
    // a previous block has just expired (so the caller is not re-blocked on
    // the very next request because of hits counted before the block).
    const baseEntry: RateLimitEntry =
      cachedEntry &&
      cachedEntry.expiresAt > now &&
      cachedEntry.blockedUntil === 0
        ? cachedEntry
        : {
            totalHits: 0,
            expiresAt: now + ttl,
            blockedUntil: 0,
          };

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

  private toRecord(
    entry: RateLimitEntry,
    now: number,
  ): AppRateLimitStorageRecord {
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
