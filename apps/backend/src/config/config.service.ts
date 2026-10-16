import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import stellarConfig from '../stellar/config/stellar.config';
import { config } from '../lib/config';
import { StellarConfigResponseDto } from './dto/stellar-config.dto';

const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

const STELLAR_CONFIG_CACHE_KEY = 'stellar-config';

@Injectable()
export class ConfigService {
  constructor(
    @Inject(stellarConfig.KEY)
    private readonly stellarCfg: ConfigType<typeof stellarConfig>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  // In-memory overrides for runtime-updated Stellar contract IDs.
  // Stored separately from the frozen global `config` object so they
  // can be updated at runtime without mutating the frozen config.
  private contractOverrides: Record<string, string | null> = {};

  // In-memory override for the Stellar testnet admin address recorded in
  // `apps/onchain/testnet-manifest.json` (`admin_address`). Updated at
  // runtime by `DeploymentManifestService.refreshManifest()` when the
  // manifest file changes, so an admin key rotation is picked up without
  // requiring a backend restart (see `docs/ADMIN_KEY_ROTATION_RUNBOOK.md`).
  private adminAddressOverride: string | null = null;

  // Per-contract admin overrides (e.g. `treasury.admin_address` in the
  // manifest). Most deployments reuse the top-level admin; when a contract
  // records its own `admin_address` it is tracked here.
  private contractAdminOverrides: Record<string, string | null> = {};

  getStellarConfig(): StellarConfigResponseDto {
    const network = this.stellarCfg.network;
    const overrides = this.contractOverrides || {};

    return {
      network,
      horizonUrl: this.stellarCfg.horizonUrl,
      sorobanRpcUrl:
        config.stellar.sorobanRpcUrl ?? DEFAULT_SOROBAN_RPC_URLS[network],
      networkPassphrase: NETWORK_PASSPHRASES[network],
      // Top-level manifest admin. Null when no manifest admin has been
      // observed yet (e.g. before the first `refreshManifest()` call).
      adminAddress: this.adminAddressOverride,
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
   * Returns the last admin address observed from the deployment manifest
   * without a restart. Null when no manifest refresh has recorded one yet.
   */
  getStellarAdminAddress(): string | null {
    return this.adminAddressOverride;
  }

  /**
   * Returns per-contract admin overrides keyed by camelCase contract name.
   */
  getStellarContractAdmins(): Record<string, string | null> {
    return { ...this.contractAdminOverrides };
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
   * Apply the top-level manifest admin address without a restart.
   * Called by `DeploymentManifestService.refreshManifest()` when
   * `admin_address` changes on disk (admin key rotation).
   */
  setStellarAdminAddress(address: string | null): void {
    this.adminAddressOverride = address;
  }

  /**
   * Apply per-contract admin overrides (camelCase contract name -> admin).
   * Tracks contracts that record their own `admin_address` in the manifest.
   */
  setStellarContractAdminOverrides(
    updates: Record<string, string | null | undefined>,
  ): void {
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) {
        continue;
      }
      this.contractAdminOverrides[k] = v;
    }
  }

  /**
   * Invalidates the cached Stellar configuration.
   * Called after contract IDs are rotated to ensure clients see updated values.
   */
  async invalidateCache(): Promise<void> {
    await this.cacheManager.del(STELLAR_CONFIG_CACHE_KEY);
  }
}
