const mockConfig = {
  soroban: { simulationCacheEnabled: true },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { SimulationCacheService } from './simulation-cache.service';
import { CacheService } from '../../cache/cache.service';
import { Registry } from 'prom-client';

describe('SimulationCacheService', () => {
  let service: SimulationCacheService;
  let cacheService: jest.Mocked<CacheService>;
  let registry: Registry;

  beforeEach(async () => {
    registry = new Registry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationCacheService,
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            invalidateContractRead: jest.fn(),
          },
        },
        {
          provide: Registry,
          useValue: registry,
        },
      ],
    }).compile();

    service = module.get(SimulationCacheService);
    cacheService = module.get(CacheService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('isEnabled', () => {
    it('returns true when config flag is enabled', () => {
      mockConfig.soroban.simulationCacheEnabled = true;
      expect(service.isEnabled).toBe(true);
    });

    it('returns false when config flag is disabled', () => {
      const original = mockConfig.soroban.simulationCacheEnabled;
      mockConfig.soroban.simulationCacheEnabled = false;
      expect(service.isEnabled).toBe(false);
      mockConfig.soroban.simulationCacheEnabled = original;
    });
  });

  describe('buildCacheKey', () => {
    it('produces a deterministic key from contract, method, args, and ledger sequence', () => {
      const key1 = service.buildCacheKey('CONTRACT_A', 'get_admin', { id: 1 }, 100);
      const key2 = service.buildCacheKey('CONTRACT_A', 'get_admin', { id: 1 }, 100);
      expect(key1).toBe(key2);
    });

    it('produces different keys for different ledger sequences', () => {
      const key1 = service.buildCacheKey('CONTRACT_A', 'get_admin', {}, 100);
      const key2 = service.buildCacheKey('CONTRACT_A', 'get_admin', {}, 101);
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different contracts', () => {
      const key1 = service.buildCacheKey('CONTRACT_A', 'get_admin', {}, 100);
      const key2 = service.buildCacheKey('CONTRACT_B', 'get_admin', {}, 100);
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different methods', () => {
      const key1 = service.buildCacheKey('CONTRACT_A', 'get_admin', {}, 100);
      const key2 = service.buildCacheKey('CONTRACT_A', 'get_token', {}, 100);
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different args', () => {
      const key1 = service.buildCacheKey('CONTRACT_A', 'get_admin', { a: 1 }, 100);
      const key2 = service.buildCacheKey('CONTRACT_A', 'get_admin', { a: 2 }, 100);
      expect(key1).not.toBe(key2);
    });

    it('uses tracked ledger sequence when none provided', () => {
      service.onLedgerAdvance(500);
      const key = service.buildCacheKey('C', 'method', {});
      expect(key).toContain(':500');
    });
  });

  describe('getOrFetch', () => {
    const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
    const method = 'get_admin';
    const args = {};
    const fetcherResult = { result: 'simulation-data' };

    it('returns cached value on cache hit without calling fetcher', async () => {
      cacheService.get.mockResolvedValue(fetcherResult);
      const fetcher = jest.fn();

      const result = await service.getOrFetch(contractId, method, args, fetcher);

      expect(result).toEqual(fetcherResult);
      expect(fetcher).not.toHaveBeenCalled();
      expect(cacheService.get).toHaveBeenCalledTimes(1);
    });

    it('calls fetcher and caches result on cache miss', async () => {
      cacheService.get.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue(fetcherResult);

      const result = await service.getOrFetch(contractId, method, args, fetcher);

      expect(result).toEqual(fetcherResult);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cacheService.set).toHaveBeenCalledTimes(1);
      expect(cacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        fetcherResult,
        30_000, // DEFAULT_SIMULATION_TTL_MS
      );
    });

    it('uses custom TTL when provided', async () => {
      cacheService.get.mockResolvedValue(undefined);
      const fetcher = jest.fn().mockResolvedValue(fetcherResult);

      await service.getOrFetch(contractId, method, args, fetcher, { ttlMs: 5000 });

      expect(cacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        fetcherResult,
        5000,
      );
    });

    it('bypasses cache when disabled via config', async () => {
      const original = mockConfig.soroban.simulationCacheEnabled;
      mockConfig.soroban.simulationCacheEnabled = false;
      const fetcher = jest.fn().mockResolvedValue(fetcherResult);

      const result = await service.getOrFetch(contractId, method, args, fetcher);

      expect(result).toEqual(fetcherResult);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cacheService.get).not.toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
      mockConfig.soroban.simulationCacheEnabled = original;
    });

    it('falls through to fetcher when cache read throws', async () => {
      cacheService.get.mockRejectedValue(new Error('Redis down'));
      const fetcher = jest.fn().mockResolvedValue(fetcherResult);

      const result = await service.getOrFetch(contractId, method, args, fetcher);

      expect(result).toEqual(fetcherResult);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('still returns fetcher result when cache write throws', async () => {
      cacheService.get.mockResolvedValue(undefined);
      cacheService.set.mockRejectedValue(new Error('Redis write failed'));
      const fetcher = jest.fn().mockResolvedValue(fetcherResult);

      const result = await service.getOrFetch(contractId, method, args, fetcher);

      expect(result).toEqual(fetcherResult);
    });
  });

  describe('onLedgerAdvance', () => {
    it('bumps the tracked ledger sequence when given a higher value', () => {
      service.onLedgerAdvance(100);
      const key1 = service.buildCacheKey('C', 'm', {});
      expect(key1).toContain(':100');

      service.onLedgerAdvance(200);
      const key2 = service.buildCacheKey('C', 'm', {});
      expect(key2).toContain(':200');
      expect(key1).not.toBe(key2);
    });

    it('does not regress when given a lower value', () => {
      service.onLedgerAdvance(200);
      service.onLedgerAdvance(100);

      const key = service.buildCacheKey('C', 'm', {});
      expect(key).toContain(':200');
    });

    it('causes cache misses for previously cached entries', async () => {
      const contractId = 'C_TEST';
      const method = 'fn';
      const args = {};
      const fetcher = jest.fn().mockResolvedValue('result');

      // Cache at ledger 100
      cacheService.get.mockResolvedValue(undefined);
      service.onLedgerAdvance(100);
      await service.getOrFetch(contractId, method, args, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance ledger — key changes, so cache.get returns undefined for the new key
      service.onLedgerAdvance(101);
      cacheService.get.mockResolvedValue(undefined);
      await service.getOrFetch(contractId, method, args, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateContract', () => {
    it('delegates to CacheService.invalidateContractRead', async () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
      await service.invalidateContract(contractId);

      expect(cacheService.invalidateContractRead).toHaveBeenCalledWith(contractId);
    });

    it('does not throw when CacheService.invalidateContractRead fails', async () => {
      cacheService.invalidateContractRead.mockRejectedValue(new Error('Redis down'));

      await expect(
        service.invalidateContract('SOME_CONTRACT'),
      ).resolves.not.toThrow();
    });
  });
});
