import { Injectable, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
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

@Injectable()
export class ConfigService {
  constructor(
    @Inject(stellarConfig.KEY)
    private readonly stellarCfg: ConfigType<typeof stellarConfig>,
  ) {}

  getStellarConfig(): StellarConfigResponseDto {
    const network = this.stellarCfg.network;

    return {
      network,
      horizonUrl: this.stellarCfg.horizonUrl,
      sorobanRpcUrl:
        config.stellar.sorobanRpcUrl ??
        DEFAULT_SOROBAN_RPC_URLS[network],
      networkPassphrase: NETWORK_PASSPHRASES[network],
      contracts: {
        lumenToken: config.stellar.contracts.lumenToken ?? null,
        crowdfundVault: config.stellar.contracts.crowdfundVault ?? null,
        projectRegistry: config.stellar.contracts.projectRegistry ?? null,
        contributorRegistry:
          config.stellar.contracts.contributorRegistry ?? null,
        matchingPool: config.stellar.contracts.matchingPool ?? null,
        treasury: config.stellar.contracts.treasury ?? null,
      },
    };
  }
}
