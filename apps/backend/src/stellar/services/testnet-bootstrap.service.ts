import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '../../config/config.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { StrKey } from '@stellar/stellar-sdk';
import { TestnetBootstrapResponseDto } from '../dto/testnet-bootstrap.dto';

/**
 * Friendbot is Stellar's testnet-only account funding faucet.
 * This URL is hardcoded and never derivable from config or request input.
 * @see https://developers.stellar.org/docs/build/apps/asset-issuance/testnet-setup#create-a-testnet-account
 */
const FRIENDBOT_TESTNET_URL = 'https://friendbot.stellar.org';
const FRIENDBOT_FUND_PATH = '/';

/**
 * Service for bootstrapping testnet accounts via Friendbot.
 *
 * SECURITY CRITICAL:
 * - Environment gate: Friendbot is only callable on testnet.
 * - URL hardcoding: Friendbot URL cannot be overridden by config or request input.
 * - Auth: Delegated to controller guard (JwtAuthGuard + admin-only decorator).
 * - Rate limiting: Applied at controller level via RateLimitGuard.
 *
 * This service fails closed on any ambiguity (e.g., network config unset).
 */
@Injectable()
export class TestnetBootstrapService {
  private readonly logger = new Logger(TestnetBootstrapService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Fund a testnet account via Friendbot.
   *
   * SECURITY GATES:
   * 1. Verifies the app is configured for testnet (not mainnet or unset).
   * 2. Validates the public key is well-formed.
   * 3. Calls Friendbot with a hardcoded testnet URL.
   *
   * @param publicKey - Stellar testnet public key (must be validated by caller)
   * @returns Success response with transaction details
   * @throws ForbiddenException - If not on testnet
   * @throws BadRequestException - If public key is invalid
   * @throws ServiceUnavailableException - If Friendbot is down or rate-limited
   * @throws HttpException - If Friendbot rejects the request
   */
  async fundTestnetAccount(
    publicKey: string,
  ): Promise<TestnetBootstrapResponseDto> {
    // ===== SECURITY GATE 1: Environment Check (CRITICAL) =====
    // Fail closed: if network config is not explicitly testnet, reject.
    const stellarConfig = this.configService.getStellarConfig();
    if (stellarConfig.network !== 'testnet') {
      this.logger.warn(
        `testnet-bootstrap attempted on ${stellarConfig.network} network - REJECTED`,
      );
      throw new ForbiddenException({
        code: ErrorCode.STEL_TESTNET_ONLY,
        message:
          'This endpoint is only available on testnet. Current deployment is configured for ' +
          stellarConfig.network,
      });
    }

    // ===== SECURITY GATE 2: Public Key Validation =====
    // Validate the key format before making any external calls.
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      this.logger.warn(`Invalid public key format attempted: ${publicKey}`);
      throw new BadRequestException({
        code: ErrorCode.STEL_INVALID_ADDRESS,
        message: `Invalid Stellar public key: ${publicKey}. Must be a valid Ed25519 public key (starting with G).`,
      });
    }

    // ===== SECURITY GATE 3: Hardcoded Friendbot URL (CRITICAL) =====
    // Never accept Friendbot URL from config or request input.
    // This URL is hardcoded to ensure outbound calls cannot be redirected.
    const friendbotUrl = `${FRIENDBOT_TESTNET_URL}${FRIENDBOT_FUND_PATH}`;

    this.logger.debug(
      `Funding testnet account ${publicKey} via Friendbot at ${FRIENDBOT_TESTNET_URL}`,
    );

    try {
      // Call Friendbot with the public key as a query parameter.
      // Friendbot's API: GET /?addr=<public_key>
      const response = await axios.get(friendbotUrl, {
        params: { addr: publicKey },
        timeout: 10000, // 10 second timeout
      });

      // Extract transaction hash from Friendbot response if present
      const txHash =
        response.data?.transaction_hash ||
        response.data?.id ||
        response.data?.hash;

      const fundingAmount =
        response.data?.amount_lumens || response.data?.amount || '100';

      this.logger.log(
        `Successfully funded testnet account ${publicKey}, tx: ${txHash}`,
      );

      return {
        success: true,
        message: 'Account successfully funded via Friendbot',
        publicKey,
        transactionHash: txHash,
        fundingAmount,
      };
    } catch (error) {
      return this.handleFriendBotError(error, publicKey);
    }
  }

  /**
   * Handle Friendbot error responses with distinct failure modes.
   *
   * Friendbot can fail in several ways:
   * - 400: Invalid public key (should not reach here due to validation)
   * - 400 with specific message: Already funded (within rate limit window)
   * - 429: Rate limited (Friendbot's own rate limit)
   * - 503: Friendbot is down
   * - Network timeout
   *
   * Each should surface as a distinct error code so callers can handle appropriately.
   */
  private handleFriendBotError(
    error: unknown,
    publicKey: string,
  ): Promise<never> {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data as Record<string, any> | undefined;

      if (status === 429) {
        // Friendbot's own rate limit (too many requests to same account)
        this.logger.warn(
          `Friendbot rate-limited for ${publicKey}: ${data?.message || 'rate limited'}`,
        );
        throw new HttpException(
          {
            code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
            message:
              'This account was recently funded. Please try again later.',
            retryAfterSeconds: 300, // Friendbot typically rate-limits for 5 minutes per account
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (status === 400) {
        const errorMsg = data?.message || '';
        if (
          errorMsg.includes('already funded') ||
          errorMsg.includes('already has') ||
          errorMsg.includes('recently')
        ) {
          // Friendbot indicates the account was recently funded
          this.logger.warn(
            `Account ${publicKey} already funded: ${errorMsg}`,
          );
          throw new HttpException(
            {
              code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
              message:
                'This account was recently funded by Friendbot. Please try again later.',
              friendbotMessage: errorMsg,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        // Generic 400 from Friendbot
        this.logger.error(
          `Friendbot rejected request for ${publicKey}: ${errorMsg}`,
        );
        throw new HttpException(
          {
            code: ErrorCode.STEL_FRIENDBOT_FAILED,
            message: `Friendbot rejected the funding request: ${errorMsg}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (status === 503) {
        // Friendbot is temporarily unavailable
        this.logger.error(`Friendbot service unavailable (503)`);
        throw new ServiceUnavailableException({
          code: ErrorCode.STEL_RPC_UNAVAILABLE,
          message: 'Friendbot is temporarily unavailable. Please try again later.',
        });
      }

      // Any other HTTP error from Friendbot
      this.logger.error(
        `Friendbot HTTP error ${status}: ${data?.message || axiosError.message}`,
      );
      throw new HttpException(
        {
          code: ErrorCode.STEL_FRIENDBOT_FAILED,
          message: `Friendbot error: ${data?.message || 'unknown error'}`,
        },
        status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (error instanceof Error) {
      // Network/timeout errors
      if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
        this.logger.error(`Friendbot connection error: ${error.message}`);
        throw new ServiceUnavailableException({
          code: ErrorCode.STEL_RPC_UNAVAILABLE,
          message: 'Unable to reach Friendbot. Please try again later.',
        });
      }

      this.logger.error(`Unexpected error calling Friendbot: ${error.message}`);
      throw new HttpException(
        {
          code: ErrorCode.STEL_FRIENDBOT_FAILED,
          message: 'Unexpected error while funding account',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    throw new HttpException(
      {
        code: ErrorCode.STEL_FRIENDBOT_FAILED,
        message: 'Unexpected error while funding account',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
