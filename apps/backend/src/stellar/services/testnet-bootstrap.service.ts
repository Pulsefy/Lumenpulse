import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { StrKey } from '@stellar/stellar-sdk';
import { ConfigService } from '../../config/config.service';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { config } from '../../lib/config';
import { TestnetBootstrapResponseDto } from '../dto/testnet-bootstrap.dto';

/**
 * Friendbot is Stellar's testnet-only account funding faucet.
 * This URL is hardcoded and never derivable from config or request input.
 */
const FRIENDBOT_TESTNET_URL = 'https://friendbot.stellar.org';

interface FriendbotSuccessBody {
  transaction_hash?: unknown;
  id?: unknown;
  hash?: unknown;
  amount_lumens?: unknown;
  amount?: unknown;
}

interface FriendbotErrorBody {
  detail?: unknown;
  title?: unknown;
  message?: unknown;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Service for bootstrapping testnet accounts via Friendbot.
 *
 * SECURITY:
 * - Environment gate: only callable when STELLAR_NETWORK=testnet
 * - Feature flag: FRIENDBOT_BOOTSTRAP_ENABLED must be true
 * - Hardcoded Friendbot URL (never configurable)
 * - Auth/rate-limit enforced at the controller layer
 */
@Injectable()
export class TestnetBootstrapService {
  private readonly logger = new Logger(TestnetBootstrapService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Fund a testnet account via Friendbot.
   */
  async fundTestnetAccount(
    publicKey: string,
  ): Promise<TestnetBootstrapResponseDto> {
    if (!config.featureFlags.friendbotBootstrap) {
      throw new ForbiddenException({
        code: ErrorCode.SYS_FORBIDDEN,
        message:
          'Friendbot bootstrap is disabled. Set FRIENDBOT_BOOTSTRAP_ENABLED=true to enable it.',
      });
    }

    const stellarConfig = this.configService.getStellarConfig();
    if (stellarConfig.network !== 'testnet') {
      this.logger.warn(
        `testnet-bootstrap attempted on ${String(stellarConfig.network)} network - REJECTED`,
      );
      throw new ForbiddenException({
        code: ErrorCode.STEL_TESTNET_ONLY,
        message:
          'This endpoint is only available on testnet. Current deployment is configured for ' +
          String(stellarConfig.network),
      });
    }

    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      this.logger.warn(`Invalid public key format attempted: ${publicKey}`);
      throw new BadRequestException({
        code: ErrorCode.STEL_INVALID_ADDRESS,
        message: `Invalid Stellar public key: ${publicKey}. Must be a valid Ed25519 public key (starting with G).`,
      });
    }

    this.logger.debug(
      `Funding testnet account ${publicKey} via Friendbot at ${FRIENDBOT_TESTNET_URL}`,
    );

    try {
      const response = await axios.get<FriendbotSuccessBody>(
        `${FRIENDBOT_TESTNET_URL}/`,
        {
          params: { addr: publicKey },
          timeout: 10_000,
        },
      );

      const data = response.data;
      const txHash =
        asOptionalString(data.transaction_hash) ??
        asOptionalString(data.id) ??
        asOptionalString(data.hash);
      const fundingAmount =
        asOptionalString(data.amount_lumens) ??
        asOptionalString(data.amount) ??
        '10000';

      this.logger.log(
        `Successfully funded testnet account ${publicKey}, tx: ${txHash ?? 'unknown'}`,
      );

      return {
        success: true,
        message: 'Account successfully funded via Friendbot',
        publicKey,
        transactionHash: txHash,
        fundingAmount,
      };
    } catch (error: unknown) {
      this.handleFriendBotError(error, publicKey);
    }
  }

  private handleFriendBotError(error: unknown, publicKey: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<FriendbotErrorBody>;
      const status = axiosError.response?.status;
      const data = axiosError.response?.data;
      const errorMsg =
        asOptionalString(data?.detail) ??
        asOptionalString(data?.message) ??
        asOptionalString(data?.title) ??
        axiosError.message;

      if (status === 429) {
        this.logger.warn(
          `Friendbot rate-limited for ${publicKey}: ${errorMsg}`,
        );
        throw new HttpException(
          {
            code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
            message:
              'This account was recently funded. Please try again later.',
            retryAfterSeconds: 300,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (status === 400) {
        const lower = errorMsg.toLowerCase();
        if (
          lower.includes('already funded') ||
          lower.includes('already has') ||
          lower.includes('recently') ||
          lower.includes('createaccountalreadyexist')
        ) {
          this.logger.warn(`Account ${publicKey} already funded: ${errorMsg}`);
          throw new HttpException(
            {
              code: ErrorCode.STEL_FRIENDBOT_ALREADY_FUNDED,
              message:
                'This account was recently funded by Friendbot. Please try again later.',
              friendbotMessage: errorMsg,
              retryAfterSeconds: 300,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

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

      if (status === 503 || status === 502 || status === 504) {
        this.logger.error(`Friendbot service unavailable (${String(status)})`);
        throw new ServiceUnavailableException({
          code: ErrorCode.STEL_RPC_UNAVAILABLE,
          message:
            'Friendbot is temporarily unavailable. Please try again later.',
        });
      }

      if (
        axiosError.code === 'ECONNABORTED' ||
        axiosError.code === 'ECONNREFUSED' ||
        axiosError.code === 'ENOTFOUND' ||
        axiosError.message.toLowerCase().includes('timeout')
      ) {
        this.logger.error(`Friendbot connection error: ${axiosError.message}`);
        throw new ServiceUnavailableException({
          code: ErrorCode.STEL_RPC_UNAVAILABLE,
          message: 'Unable to reach Friendbot. Please try again later.',
        });
      }

      this.logger.error(`Friendbot HTTP error ${String(status)}: ${errorMsg}`);
      throw new HttpException(
        {
          code: ErrorCode.STEL_FRIENDBOT_FAILED,
          message: `Friendbot error: ${errorMsg}`,
        },
        status && status >= 400 && status < 600
          ? status
          : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (error instanceof Error) {
      this.logger.error(`Unexpected error calling Friendbot: ${error.message}`);
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
