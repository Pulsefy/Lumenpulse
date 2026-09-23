import { Injectable, Inject, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import stellarConfig from '../stellar/config/stellar.config';
import { config } from '../lib/config';
import { StellarConfigResponseDto } from './dto/stellar-config.dto';
import {
  LEGACY_STELLAR_CONFIG_CACHE_KEY,
  STELLAR_CONFIG_CACHE_KEY,
} from '../cache/cache.constants';
import { CacheService } from '../cache/cache.service';

const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

export { STELLAR_CONFIG_CACHE_KEY, LEGACY_STELLAR_CONFIG_CACHE_KEY };
@Injectable()
export class ConfigService {
  constructor(
    @Inject(stellarConfig.KEY)
    private readonly stellarCfg: ConfigType<typeof stellarConfig>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  // In-memory overrides for runtime-updated Stellar contract IDs.
  // Stored separately from the frozen global `config` object so they
  // can be updated at runtime without mutating the frozen config.
  private contractOverrides: Record<string, string | null> = {};

  getStellarConfig(): StellarConfigResponseDto {
    const network = this.stellarCfg.network;
    const overrides = this.contractOverrides || {};

    return {
      network,
      horizonUrl: this.stellarCfg.horizonUrl,
      sorobanRpcUrl:
        config.stellar.sorobanRpcUrl ?? DEFAULT_SOROBAN_RPC_URLS[network],
      networkPassphrase: NETWORK_PASSPHRASES[network],
      contracts: {
        lumenToken:
          overrides.lumenToken ?? config.stellar.contracts.lumenToken ?? null,
        crowdfundVault:
          overrides.crowdfundVault ??
          config.stellar.contracts.crowdfundVault ??
          null,
        projectRegistry:
          overrides.projectRegistry ??
          config.stellar.contracts.projectRegistry ??
          null,
        contributorRegistry:
          overrides.contributorRegistry ??
          config.stellar.contracts.contributorRegistry ??
          null,
        matchingPool:
          overrides.matchingPool ??
          config.stellar.contracts.matchingPool ??
          null,
        treasury:
          overrides.treasury ?? config.stellar.contracts.treasury ?? null,
      },
    };
  }

  /**
   * Apply runtime overrides for Stellar contract IDs. This does not mutate
   * the frozen global config object — overrides are stored in-memory and
   * merged when serving the client-facing config endpoint.
   */
  setStellarContractOverrides(
    updates: Record<string, string | null | undefined>,
  ): void {
    for (const [k, v] of Object.entries(updates)) {
      this.contractOverrides[k] = v ?? null;
    }
  }

  /**
   * Invalidates the cached Stellar configuration.
   * Called after contract IDs are rotated to ensure clients see updated values.
   */
  async invalidateCache(): Promise<void> {
    // The HTTP interceptor uses the same key as the legacy direct cache entry.
    // Delete both the explicit key and the config/capability families so a
    // contract rotation cannot leave a dependent response stale. Attempt all
    // boundaries even if one Redis delete fails, then surface the failure.
    const results = await Promise.allSettled([
      this.cacheManager.del(STELLAR_CONFIG_CACHE_KEY),
      this.cacheManager.del(LEGACY_STELLAR_CONFIG_CACHE_KEY),
      this.cacheService?.invalidateConfigCaches() ?? Promise.resolve(),
    ]);
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) throw failure.reason;
  }
}
