import type { ConfigType } from '@nestjs/config';
import stellarConfig from '../stellar/config/stellar.config';
import { config } from '../lib/config';
import { ConfigService } from './config.service';

// Mock the config object
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

// Create a mock Cache instance to fulfill the second argument requirement
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  mget: jest.fn(),
  mset: jest.fn(),
  mdel: jest.fn(),
  reset: jest.fn(),
  wrap: jest.fn(),
  store: {} as any,
  ttl: jest.fn(),
} as any;

describe('ConfigService', () => {
  it('returns a client-safe stellar config payload', () => {
    // Cast via 'as any' or drop networkPassphrase if it belongs completely to an external definition
    const mockStellarConfig = {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1_000,
      networkPassphrase: 'Test SDF Network ; September 2015',
    } as unknown as ConfigType<typeof stellarConfig>;

    // Pass the mockCache as the second parameter to resolve the type checking mismatch
    const service = new ConfigService(mockStellarConfig, mockCache);

    expect(service.getStellarConfig()).toEqual({
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      adminAddress: null,
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

  it('exposes a rotated manifest admin without a restart (issue #1626)', () => {
    const mockStellarConfig = {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1_000,
      networkPassphrase: 'Test SDF Network ; September 2015',
    } as unknown as ConfigType<typeof stellarConfig>;

    const service = new ConfigService(mockStellarConfig, mockCache);

    expect(service.getStellarAdminAddress()).toBeNull();
    expect(service.getStellarConfig().adminAddress).toBeNull();

    const rotated =
      'GCNQBZDKZJTPFERPP65ATQWH2T6OIXQESPKXSTO6YY33TA2HTUTAPJI7';
    service.setStellarAdminAddress(rotated);

    expect(service.getStellarAdminAddress()).toBe(rotated);
    expect(service.getStellarConfig().adminAddress).toBe(rotated);

    service.setStellarContractAdminOverrides({ treasury: rotated });
    expect(service.getStellarContractAdmins()).toEqual({
      treasury: rotated,
    });
  });

  it('falls back to canonical network RPC URL when env RPC URL is absent', () => {
    (config.stellar.sorobanRpcUrl as string | null | undefined) = undefined;

    const mockStellarConfig = {
      network: 'mainnet',
      horizonUrl: 'https://horizon.stellar.org',
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1_000,
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    } as unknown as ConfigType<typeof stellarConfig>;

    // Pass the mockCache here as well
    const service = new ConfigService(mockStellarConfig, mockCache);

    expect(service.getStellarConfig().sorobanRpcUrl).toBe(
      'https://soroban.stellar.org',
    );
  });
});
