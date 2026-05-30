import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import stellarConfig from './config/stellar.config';
import { StellarService } from './stellar.service';
import { CacheService } from '../cache/cache.service';
import { AccountNotFoundException } from './exceptions/stellar.exceptions';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  getOrSet: jest.fn(),
  getAccountBalanceCached: jest.fn(),
  getAccountOperationsCached: jest.fn(),
  setCacheConfig: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: jest.fn(),
        operations: jest.fn(),
        assets: jest.fn(),
        root: jest.fn(),
      })),
    },
    StrKey: {
      isValidEd25519PublicKey: jest.fn().mockReturnValue(true),
    },
    NotFoundError: class NotFoundError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
      }
    },
    NetworkError: class NetworkError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NetworkError';
      }
    },
  };
});

describe('StellarService', () => {
  let service: StellarService;

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
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validatePublicKey', () => {
    it('validates a correct public key', () => {
      const result = service.validatePublicKey('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
      expect(result).toBe(true);
    });
  });

  describe('getAccountBalances', () => {
    it('uses cache for account balances', async () => {
      const publicKey = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
      const mockCachedResult = {
        publicKey,
        balances: [{ assetType: 'native', balance: '100' }],
      };

      mockCacheService.getAccountBalanceCached.mockResolvedValue(mockCachedResult);

      const result = await service.getAccountBalances(publicKey);

      expect(result).toEqual(mockCachedResult);
      expect(mockCacheService.getAccountBalanceCached).toHaveBeenCalledWith(
        publicKey,
        expect.any(Function),
      );
    });
  });

  describe('accountExists', () => {
    it('returns true when account exists', async () => {
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValue({
          balances: [],
          sequenceNumber: () => '123',
        }),
      };
      (service as any).server = mockServer;

      const result = await service.accountExists(
        'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(result).toBe(true);
    });
  });

  describe('getAccountInfo', () => {
    it('returns null when getAccountBalances throws AccountNotFoundException', async () => {
      mockCacheService.getAccountBalanceCached.mockImplementation(async () => {
        throw new AccountNotFoundException('test');
      });

      const result = await service.getAccountInfo('invalid-key');
      expect(result).toBeNull();
    });
  });
});