import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import stellarConfig from './config/stellar.config';
import { StellarService } from './stellar.service';
import { CacheService } from '../cache/cache.service';
import { NotFoundError } from '@stellar/stellar-sdk';
import { AccountNotFoundException } from './exceptions/stellar.exceptions';

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockServer = {
  loadAccount: jest.fn(),
  operations: jest.fn(),
  assets: jest.fn(),
  root: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockServer),
    },
    StrKey: {
      isValidEd25519PublicKey: jest.fn().mockReturnValue(true),
    },
  };
});

describe('StellarService', () => {
  let service: StellarService;
  let cacheService: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: stellarConfig.KEY,
          useValue: {
            horizonUrl: 'https://horizon-testnet.stellar.org',
            network: 'testnet',
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            balanceCacheTTL: 30000,
            operationsCacheTTL: 15000,
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        {
          provide: CacheService,
          useValue: {
            get: mockCache.get,
            set: mockCache.set,
            del: mockCache.del,
            getOrSet: jest.fn(),
            getAccountBalanceCached: jest.fn(),
            getAccountOperationsCached: jest.fn(),
            setCacheConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
    cacheService = module.get<CacheService>(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validatePublicKey', () => {
    it('validates a correct public key', () => {
      const result = service.validatePublicKey(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(result).toBe(true);
    });
  });

  describe('getAccountBalances', () => {
    it('uses cache for account balances', async () => {
      const publicKey =
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const mockCachedResult = {
        publicKey,
        balances: [{ assetType: 'native', balance: '100' }],
      };

      (cacheService as any).getAccountBalanceCached = jest
        .fn()
        .mockResolvedValue(mockCachedResult);

      const result = await service.getAccountBalances(publicKey);

      expect(result).toEqual(mockCachedResult);
      expect(
        (cacheService as any).getAccountBalanceCached,
      ).toHaveBeenCalledWith(publicKey, expect.any(Function));
    });
  });

  describe('accountExists', () => {
    it('returns true when account exists', async () => {
      mockServer.loadAccount.mockResolvedValue({
        balances: [],
        sequenceNumber: () => '123',
      });

      const result = await service.accountExists(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(result).toBe(true);
    });

    it('returns false when account not found', async () => {
      mockServer.loadAccount.mockRejectedValue(
        new NotFoundError('Not found', 'test-operation'),
      );

      const result = await service.accountExists(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(result).toBe(false);
    });
  });

  describe('getAccountInfo', () => {
    it('returns null for account not found', async () => {
      (cacheService as any).getAccountBalanceCached = jest
        .fn()
        .mockRejectedValue(new AccountNotFoundException('invalid-key'));

      const result = await service.getAccountInfo(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(result).toBeNull();
    });
  });
});
