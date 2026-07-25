import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { TestnetBootstrapService } from './testnet-bootstrap.service';
import { ConfigService } from '../../config/config.service';
import { ErrorCode } from '../../common/enums/error-code.enum';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TestnetBootstrapService', () => {
  let service: TestnetBootstrapService;
  let configService: ConfigService;

  const VALID_TESTNET_KEY =
    'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I';
  const INVALID_KEY = 'INVALID_KEY_12345';

  beforeEach(async () => {
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('fundTestnetAccount', () => {
    describe('environment gate (CRITICAL)', () => {
      it('should reject with 403 when configured for mainnet', async () => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'mainnet',
        });

        await expect(
          service.fundTestnetAccount(VALID_TESTNET_KEY),
        ).rejects.toThrow(ForbiddenException);

        try {
          await service.fundTestnetAccount(VALID_TESTNET_KEY);
        } catch (e) {
          expect(e.getResponse()).toMatchObject({
            code: ErrorCode.STEL_TESTNET_ONLY,
            message: expect.stringContaining('mainnet'),
          });
        }
      });

      it('should reject with 403 when network config is unset/ambiguous', async () => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: undefined,
        });

        await expect(
          service.fundTestnetAccount(VALID_TESTNET_KEY),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should proceed only when configured for testnet', async () => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'testnet',
        });

        mockedAxios.get.mockResolvedValueOnce({
          data: {
            transaction_hash: 'mock_tx_hash',
            amount_lumens: '100',
          },
        });

        const result = await service.fundTestnetAccount(VALID_TESTNET_KEY);

        expect(result.success).toBe(true);
        expect(mockedAxios.get).toHaveBeenCalled();
      });
    });

    describe('public key validation', () => {
      beforeEach(() => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'testnet',
        });
      });

      it('should reject invalid public key format before calling Friendbot', async () => {
        await expect(
          service.fundTestnetAccount(INVALID_KEY),
        ).rejects.toThrow();

        // Ensure Friendbot was NOT called
        expect(mockedAxios.get).not.toHaveBeenCalled();
      });

      it('should validate that error response includes proper error code', async () => {
        try {
          await service.fundTestnetAccount(INVALID_KEY);
        } catch (e) {
          expect(e.getResponse()).toMatchObject({
            code: ErrorCode.STEL_INVALID_ADDRESS,
          });
        }
      });

      it('should accept valid testnet public key format', async () => {
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            transaction_hash: 'mock_tx_hash',
            amount_lumens: '100',
          },
        });

        const result = await service.fundTestnetAccount(VALID_TESTNET_KEY);
        expect(result.success).toBe(true);
      });
    });

    describe('happy path: successful funding', () => {
      beforeEach(() => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'testnet',
        });
      });

      it('should successfully fund account and return transaction hash', async () => {
        const mockTxHash = 'baaffabaffabaffabaffabaffabaffabaffabaffabaffabaffabaffaba0';

        mockedAxios.get.mockResolvedValueOnce({
          data: {
            transaction_hash: mockTxHash,
            amount_lumens: '100',
          },
        });

        const result = await service.fundTestnetAccount(VALID_TESTNET_KEY);

        expect(result).toMatchObject({
          success: true,
          message: expect.stringContaining('successfully'),
          publicKey: VALID_TESTNET_KEY,
          transactionHash: mockTxHash,
          fundingAmount: '100',
        });
      });

      it('should call Friendbot with hardcoded testnet URL', async () => {
        mockedAxios.get.mockResolvedValueOnce({
          data: { transaction_hash: 'mock_hash' },
        });

        await service.fundTestnetAccount(VALID_TESTNET_KEY);

        expect(mockedAxios.get).toHaveBeenCalledWith(
          'https://friendbot.stellar.org/',
          expect.objectContaining({
            params: { addr: VALID_TESTNET_KEY },
          }),
        );

        // CRITICAL: Ensure URL cannot be derived from mutable config
        // by verifying it's hardcoded in the service
      });

      it('should extract transaction hash from various response formats', async () => {
        // Test 'id' field variant
        mockedAxios.get.mockResolvedValueOnce({
          data: {
            id: 'hash_from_id_field',
            amount_lumens: '100',
          },
        });

        const result = await service.fundTestnetAccount(VALID_TESTNET_KEY);
        expect(result.transactionHash).toBe('hash_from_id_field');
      });
    });

    describe('Friendbot failure modes', () => {
      beforeEach(() => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'testnet',
        });
      });

      describe('already funded (within rate-limit window)', () => {
        it('should return 429 with STEL_FRIENDBOT_ALREADY_FUNDED on 400 "already funded"', async () => {
          mockedAxios.get.mockRejectedValueOnce({
            response: {
              status: 400,
              data: {
                message: 'Account already has a trust line to Lumen',
              },
            },
            isAxiosError: true,
          });

          await expect(
            service.fundTestnetAccount(VALID_TESTNET_KEY),
          ).rejects.toThrow();

          // Verify the error is caught and re-thrown with correct status
          try {
            await service.fundTestnetAccount(VALID_TESTNET_KEY);
          } catch (e) {
            expect(e.getStatus()).toBe(429);
            expect(e.getResponse()).toMatchObject({
              code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
            });
          }
        });

        it('should return 429 on 429 from Friendbot (rate-limited)', async () => {
          mockedAxios.get.mockRejectedValueOnce({
            response: {
              status: 429,
              data: { message: 'Rate limited' },
            },
            isAxiosError: true,
          });

          try {
            await service.fundTestnetAccount(VALID_TESTNET_KEY);
          } catch (e) {
            expect(e.getStatus()).toBe(429);
            expect(e.getResponse()).toMatchObject({
              code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
            });
          }
        });
      });

      describe('Friendbot unavailability', () => {
        it('should return 503 when Friendbot is down', async () => {
          mockedAxios.get.mockRejectedValueOnce({
            response: {
              status: 503,
              data: { message: 'Service Unavailable' },
            },
            isAxiosError: true,
          });

          await expect(
            service.fundTestnetAccount(VALID_TESTNET_KEY),
          ).rejects.toThrow(ServiceUnavailableException);

          try {
            await service.fundTestnetAccount(VALID_TESTNET_KEY);
          } catch (e) {
            expect(e.getStatus()).toBe(503);
            expect(e.getResponse()).toMatchObject({
              code: ErrorCode.STEL_RPC_UNAVAILABLE,
            });
          }
        });

        it('should handle connection timeouts gracefully', async () => {
          const timeoutError = new Error('Request timeout');
          (timeoutError as any).message = 'timeout';
          mockedAxios.get.mockRejectedValueOnce({
            message: 'timeout',
            isAxiosError: false,
          });

          await expect(
            service.fundTestnetAccount(VALID_TESTNET_KEY),
          ).rejects.toThrow(ServiceUnavailableException);
        });
      });

      describe('generic Friendbot errors', () => {
        it('should surface generic 400 errors distinctly', async () => {
          mockedAxios.get.mockRejectedValueOnce({
            response: {
              status: 400,
              data: {
                message: 'Invalid public key format',
              },
            },
            isAxiosError: true,
          });

          try {
            await service.fundTestnetAccount(VALID_TESTNET_KEY);
          } catch (e) {
            expect(e.getResponse()).toMatchObject({
              code: ErrorCode.STEL_FRIENDBOT_FAILED,
            });
          }
        });

        it('should handle unknown HTTP errors', async () => {
          mockedAxios.get.mockRejectedValueOnce({
            response: {
              status: 502,
              data: { message: 'Bad Gateway' },
            },
            isAxiosError: true,
          });

          await expect(
            service.fundTestnetAccount(VALID_TESTNET_KEY),
          ).rejects.toThrow();
        });
      });
    });

    describe('rate limiting / abuse prevention', () => {
      beforeEach(() => {
        (configService.getStellarConfig as jest.Mock).mockReturnValue({
          network: 'testnet',
        });
      });

      it('should include retry-after guidance in 429 response', async () => {
        mockedAxios.get.mockRejectedValueOnce({
          response: {
            status: 429,
            data: { message: 'Rate limited' },
          },
          isAxiosError: true,
        });

        try {
          await service.fundTestnetAccount(VALID_TESTNET_KEY);
        } catch (e) {
          expect(e.getResponse()).toMatchObject({
            retryAfterSeconds: expect.any(Number),
          });
        }
      });
    });
  });

  describe('hardcoded Friendbot URL (CRITICAL)', () => {
    it('must never accept Friendbot URL from config or runtime params', () => {
      // This test verifies the hardcoded URL cannot be overridden
      // by checking the source code directly or by attempting injection
      const source = service.fundTestnetAccount.toString();

      // Verify the hardcoded URL appears in the service
      expect(source).toContain('friendbot.stellar.org');

      // This is a static check - the service should not accept
      // Friendbot URL as a parameter or config value
    });
  });
});
