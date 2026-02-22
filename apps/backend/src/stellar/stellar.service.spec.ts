/* eslint-disable @typescript-eslint/no-require-imports */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Horizon, NotFoundError, NetworkError } from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service';
import stellarConfig from './config/stellar.config';
import {
  AccountNotFoundException,
  HorizonUnavailableException,
  InvalidPublicKeyException,
} from './exceptions/stellar.exceptions';

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const mockAccount = {
    balances: [
      {
        asset_type: 'native',
        balance: '1000.0000000',
        buying_liabilities: '0.0000000',
        selling_liabilities: '0.0000000',
      },
    ],
    sequenceNumber: () => '123456789',
  };

  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        root: jest.fn().mockResolvedValue({}),
      })),
    },
    NotFoundError: class NotFoundError extends Error {
      response = { status: 404 };
    },
    NetworkError: class NetworkError extends Error {},
    StrKey: {
      isValidEd25519PublicKey: jest.fn().mockReturnValue(true),
    },
  };
});

describe('StellarService', () => {
  let service: StellarService;
  let mockServer: jest.Mocked<Horizon.Server>;

  const validPublicKey =
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [stellarConfig],
        }),
      ],
      providers: [StellarService],
    }).compile();

    service = module.get<StellarService>(StellarService);
    mockServer = service['server'] as jest.Mocked<Horizon.Server>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAccountBalances', () => {
    it('should fetch account balances successfully', async () => {
      const result = await service.getAccountBalances(validPublicKey);

      expect(result).toHaveProperty('publicKey', validPublicKey);
      expect(result).toHaveProperty('balances');
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0]).toHaveProperty('assetType', 'native');
      expect(result.balances[0]).toHaveProperty('balance', '1000.0000000');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockServer.loadAccount).toHaveBeenCalledWith(validPublicKey);
    });

    it('should throw AccountNotFoundException for 404 errors', async () => {
      const notFoundError = new NotFoundError('Account not found');
      (mockServer.loadAccount as jest.Mock).mockRejectedValueOnce(
        notFoundError,
      );

      await expect(service.getAccountBalances(validPublicKey)).rejects.toThrow(
        AccountNotFoundException,
      );
    });

    it('should throw HorizonUnavailableException for network errors', async () => {
      const networkError = new NetworkError('Network error');
      (mockServer.loadAccount as jest.Mock).mockRejectedValue(networkError);

      await expect(service.getAccountBalances(validPublicKey)).rejects.toThrow(
        HorizonUnavailableException,
      );
    });

    it('should validate public key format', async () => {
      const invalidKey = 'INVALID_KEY';

      // Mock validator to throw
      jest
        .spyOn(require('./utils/stellar-validator'), 'validateStellarPublicKey')
        .mockImplementation(() => {
          throw new InvalidPublicKeyException(invalidKey);
        });

      await expect(service.getAccountBalances(invalidKey)).rejects.toThrow(
        InvalidPublicKeyException,
      );
    });
  });

  describe('checkHealth', () => {
    it('should return true when Horizon is available', async () => {
      const isHealthy = await service.checkHealth();
      expect(isHealthy).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockServer.root).toHaveBeenCalled();
    });

    it('should return false when Horizon is unavailable', async () => {
      (mockServer.root as jest.Mock).mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      const isHealthy = await service.checkHealth();
      expect(isHealthy).toBe(false);
    });
  });
});
