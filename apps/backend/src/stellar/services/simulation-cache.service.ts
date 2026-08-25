import { Injectable, Logger, Optional } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { config } from '../../lib/config';
import { CacheService } from '../../cache/cache.service';

const SIMULATION_CACHE_PREFIX = 'sim:cache';

/** Default TTL for simulation cache entries (30 seconds — one ledger window). */
const DEFAULT_SIMULATION_TTL_MS = 30_000;

export interface SimulationCacheOptions {
  /** TTL override in milliseconds. Defaults to one ledger window. */
  ttlMs?: number;
}

/**
 * Caches Soroban read-only simulation results keyed by contract, function,
 * arguments, and ledger sequence. Entries are automatically invalidated
 * when the ledger advances.
 *
 * Only calls with no state-changing effect are eligible — eligibility is
 * determined by the caller explicitly choosing to use the cache, not by
 * inference from transaction type.
 */
@Injectable()
export class SimulationCacheService {
  private readonly logger = new Logger(SimulationCacheService.name);

  // Prometheus metrics
  private readonly cacheHits: Counter;
  private readonly cacheMisses: Counter;
  private readonly cacheLatency: Histogram;
  private readonly rpcCallsAvoided: Gauge;

  /** Tracks the latest ledger sequence we've seen for cache invalidation. */
  private latestLedgerSequence: number = 0;

  constructor(
    private readonly cacheService: CacheService,
    @Optional() private readonly registry?: Registry,
  ) {
    const reg = this.registry ?? new Registry();

    this.cacheHits = new Counter({
      name: 'soroban_simulation_cache_hits_total',
      help: 'Total cache hits for read-only simulation results',
      labelNames: ['contract', 'method'],
      registers: [reg],
    });

    this.cacheMisses = new Counter({
      name: 'soroban_simulation_cache_misses_total',
      help: 'Total cache misses for read-only simulation results',
      labelNames: ['contract', 'method'],
      registers: [reg],
    });

    this.cacheLatency = new Histogram({
      name: 'soroban_simulation_cache_latency_ms',
      help: 'Latency of simulation cache lookups in milliseconds',
      labelNames: ['status'],
      buckets: [1, 5, 10, 25, 50, 100],
      registers: [reg],
    });

    this.rpcCallsAvoided = new Gauge({
      name: 'soroban_rpc_calls_avoided_total',
      help: 'Cumulative count of Soroban RPC calls avoided by simulation cache',
      registers: [reg],
    });
  }

  /**
   * Whether the simulation cache feature is enabled via configuration.
   */
  get isEnabled(): boolean {
    return config.soroban.simulationCacheEnabled;
  }

  /**
   * Build a deterministic cache key from the components of a read-only
   * simulation call.
   *
   * Key format: `sim:cache:{contractId}:{method}:{argsHash}:{ledgerSeq}`
   *
   * The ledger sequence is included so that cache entries are naturally
   * invalidated when the ledger advances — a new ledger produces a
   * different key, causing a cache miss.
   */
  buildCacheKey(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
    ledgerSequence?: number,
  ): string {
    const argsHash = Buffer.from(JSON.stringify(args)).toString('base64');
    const seq = ledgerSequence ?? this.latestLedgerSequence;
    return `${SIMULATION_CACHE_PREFIX}:${contractId}:${method}:${argsHash}:${seq}`;
  }

  /**
   * Retrieve a cached simulation result, or execute the fetcher, cache the
   * result, and return it. This is the primary entry point for callers.
   *
   * @param contractId  - Soroban contract address
   * @param method      - Contract method name (read-only)
   * @param args        - Serialized arguments (will be JSON-stringified)
   * @param fetcher     - Function that performs the actual RPC simulation
   * @param opts        - Optional TTL override
   * @returns The simulation result (cached or freshly fetched)
   */
  async getOrFetch<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    fetcher: () => Promise<T>,
    opts?: SimulationCacheOptions,
  ): Promise<T> {
    if (!this.isEnabled) {
      return fetcher();
    }

    const key = this.buildCacheKey(contractId, method, args);
    const timer = this.cacheLatency.startTimer();

    try {
      const cached = await this.cacheService.get<T>(key);
      if (cached !== undefined) {
        timer({ status: 'hit' });
        this.cacheHits.inc({ contract: contractId, method });
        this.rpcCallsAvoided.inc();
        this.logger.debug(
          `Simulation cache HIT: ${contractId}:${method}`,
        );
        return cached;
      }
    } catch (err) {
      // Cache read failure — fall through to fetcher
      this.logger.debug(
        `Simulation cache read error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    timer({ status: 'miss' });
    this.cacheMisses.inc({ contract: contractId, method });

    const startTime = Date.now();
    const value = await fetcher();
    const fetchDuration = Date.now() - startTime;

    const ttl = opts?.ttlMs ?? DEFAULT_SIMULATION_TTL_MS;

    try {
      await this.cacheService.set(key, value, ttl);
      this.logger.debug(
        `Simulation cache SET: ${contractId}:${method} (TTL=${ttl}ms, fetch=${fetchDuration}ms)`,
      );
    } catch (err) {
      this.logger.debug(
        `Simulation cache write error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return value;
  }

  /**
   * Called when a new ledger sequence is observed. Invalidates all
   * simulation cache entries from the previous ledger by bumping the
   * tracked sequence.
   *
   * This is a soft invalidation — old entries will naturally expire
   * via TTL. The primary effect is that new lookups use the new
   * ledger sequence in the cache key, causing automatic misses.
   */
  onLedgerAdvance(newSequence: number): void {
    if (newSequence > this.latestLedgerSequence) {
      const previous = this.latestLedgerSequence;
      this.latestLedgerSequence = newSequence;
      this.logger.debug(
        `Simulation cache: ledger advanced ${previous} → ${newSequence}`,
      );
    }
  }

  /**
   * Explicitly invalidate all cached entries for a specific contract.
   * Called when a contract ID is rotated or replaced.
   */
  async invalidateContract(contractId: string): Promise<void> {
    try {
      await this.cacheService.invalidateContractRead(contractId);
      this.logger.debug(
        `Simulation cache: invalidated all entries for contract ${contractId}`,
      );
    } catch (err) {
      this.logger.debug(
        `Simulation cache invalidation error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Get current cache hit rate as a ratio [0, 1].
   */
  getHitRate(): number {
    const hits = this.cacheHits.get();
    const misses = this.cacheMisses.get();
    const total = hits + misses;
    return total > 0 ? hits / total : 0;
  }

  /**
   * Get current cache statistics for reporting.
   */
  getStats(): {
    hitRate: number;
    totalHits: number;
    totalMisses: number;
    rpcCallsAvoided: number;
    enabled: boolean;
  } {
    return {
      hitRate: this.getHitRate(),
      totalHits: this.cacheHits.get(),
      totalMisses: this.cacheMisses.get(),
      rpcCallsAvoided: this.rpcCallsAvoided.get(),
      enabled: this.isEnabled,
    };
  }
}
