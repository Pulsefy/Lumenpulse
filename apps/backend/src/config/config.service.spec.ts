import type { ConfigType } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';
import { config } from '../lib/config';
import { ConfigService } from './config.service';

jest.mock('../lib/config', () => ({
  config: {
    stellar: {
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      contracts: {
        lumenToken: 'CLUMEN',
        crowdfundVault: 'CCROWDFUND',
        projectRegistry: 'CPROJECT',
        contributorRegistry: 'CCONTRIB',
        matchingPool: 'CMATCH',
        treasury: 'CTREASURY',
      },
    },
  },
}));

describe('ConfigService', () => {
  it('returns a client-safe stellar config payload', () => {
    const service = new ConfigService({
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1_000,
    } as ConfigType<typeof stellarConfig>);

    expect(service.getStellarConfig()).toEqual({
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contracts: {
        lumenToken: 'CLUMEN',
        crowdfundVault: 'CCROWDFUND',
        projectRegistry: 'CPROJECT',
        contributorRegistry: 'CCONTRIB',
        matchingPool: 'CMATCH',
        treasury: 'CTREASURY',
      },
    });
  });

  it('falls back to canonical network RPC URL when env RPC URL is absent', () => {
    (config.stellar.sorobanRpcUrl as string | null | undefined) = undefined;

    const service = new ConfigService({
      network: 'mainnet',
      horizonUrl: 'https://horizon.stellar.org',
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1_000,
    } as ConfigType<typeof stellarConfig>);

    expect(service.getStellarConfig().sorobanRpcUrl).toBe(
      'https://soroban.stellar.org',
    );
  });
});
