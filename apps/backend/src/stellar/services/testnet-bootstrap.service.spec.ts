const mockConfig = {
  featureFlags: {
    friendbotBootstrap: true,
  },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

jest.mock('axios');

import {
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '../../config/config.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { TestnetBootstrapService } from './testnet-bootstrap.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TestnetBootstrapService', () => {
  let service: TestnetBootstrapService;
  let configService: ConfigService;

  const VALID_TESTNET_KEY =
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const INVALID_KEY = 'INVALID_KEY_12345';

  beforeEach(async () => {
    mockConfig.featureFlags.friendbotBootstrap = true;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestnetBootstrapService,
        {
          provide: ConfigService,
          useValue: {
            getStellarConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TestnetBootstrapService>(TestnetBootstrapService);
    configService = module.get<ConfigService>(ConfigService);

    mockedAxios.isAxiosError = jest.fn((error: unknown): error is AxiosError =>
      Boolean(
        error &&
        typeof error === 'object' &&
        'isAxiosError' in error &&
        (error as { isAxiosError?: boolean }).isAxiosError === true,
      ),
    ) as unknown as typeof mockedAxios.isAxiosError;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fundTestnetAccount', () => {
    it('rejects when feature flag is disabled', async () => {
      mockConfig.featureFlags.friendbotBootstrap = false;

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('rejects with STEL_TESTNET_ONLY on mainnet', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'mainnet',
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toMatchObject({
        response: {
          code: ErrorCode.STEL_TESTNET_ONLY,
        },
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('rejects with STEL_TESTNET_ONLY when network is unset', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: undefined,
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('rejects invalid public keys before calling Friendbot', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });

      await expect(
        service.fundTestnetAccount(INVALID_KEY),
      ).rejects.toMatchObject({
        response: {
          code: ErrorCode.STEL_INVALID_ADDRESS,
        },
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('funds a valid key via the hardcoded Friendbot URL', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          transaction_hash: 'mock_tx_hash',
          amount_lumens: '10000',
        },
      });

      const result = await service.fundTestnetAccount(VALID_TESTNET_KEY);

      expect(result).toMatchObject({
        success: true,
        publicKey: VALID_TESTNET_KEY,
        transactionHash: 'mock_tx_hash',
        fundingAmount: '10000',
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://friendbot.stellar.org/',
        expect.objectContaining({
          params: { addr: VALID_TESTNET_KEY },
        }),
      );
    });

    it('maps Friendbot 429 to STEL_FRIENDBOT_ALREADY_FUNDED', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Too Many Requests',
        response: {
          status: 429,
          data: { detail: 'rate limited' },
        },
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toMatchObject({
        status: 429,
        response: {
          code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
        },
      });
    });

    it('maps Friendbot unavailable responses to 503', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Service Unavailable',
        response: {
          status: 503,
          data: { detail: 'down' },
        },
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('maps connection timeouts to 503', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded',
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('maps generic Friendbot 400 failures', async () => {
      (configService.getStellarConfig as jest.Mock).mockReturnValue({
        network: 'testnet',
      });
      mockedAxios.get.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Bad Request',
        response: {
          status: 400,
          data: { detail: 'bad address' },
        },
      });

      await expect(
        service.fundTestnetAccount(VALID_TESTNET_KEY),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });
});
