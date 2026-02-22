import { Injectable, Logger, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Horizon, NetworkError, NotFoundError } from '@stellar/stellar-sdk';
import { AccountBalancesDto, AssetBalanceDto } from './dto/balance.dto';
import stellarConfig, { StellarConfig } from './config/stellar.config';
import {
  AccountNotFoundException,
  HorizonUnavailableException,
} from './exceptions/stellar.exceptions';
import { validateStellarPublicKey } from './utils/stellar-validator';
import { retryWithBackoff } from './utils/retry.util';

@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly server: Horizon.Server;
  private readonly config: StellarConfig;

  constructor(
    @Inject(stellarConfig.KEY)
    config: ConfigType<typeof stellarConfig>,
  ) {
    this.config = config;
    this.server = new Horizon.Server(config.horizonUrl);

    this.logger.log(
      `StellarService initialized with ${config.network} Horizon API at ${config.horizonUrl}`,
    );
  }

  /**
   * Fetches account balances from Stellar Horizon API
   *
   * @param publicKey - Stellar account public key (must be valid Ed25519 public key)
   * @returns Promise<AccountBalancesDto> - Account balances information
   * @throws AccountNotFoundException if account is not found (404)
   * @throws HorizonUnavailableException if Horizon API is unavailable
   * @throws InvalidPublicKeyException if public key format is invalid
   */
  async getAccountBalances(publicKey: string): Promise<AccountBalancesDto> {
    // Validate public key format
    validateStellarPublicKey(publicKey);

    this.logger.debug(`Fetching balances for account: ${publicKey}`);

    try {
      // Retry logic for network failures
      const account: Horizon.AccountResponse = await retryWithBackoff(
        () => this.server.loadAccount(publicKey),
        this.config.retryAttempts,
        this.config.retryDelay,
        (error) => {
          // Retry on network errors, but not on 404 (account not found)
          if (error instanceof NetworkError) {
            return true;
          }
          if (error instanceof NotFoundError) {
            return false; // Don't retry 404 errors
          }
          // Check for network-related errors
          const errorObj = error as { response?: { status?: number } };
          const status = errorObj?.response?.status;
          return status !== 404 && (status === undefined || status >= 500);
        },
      );

      // Map balances to DTO
      const balances = this.mapBalancesToDto(account.balances);

      const result: AccountBalancesDto = {
        publicKey,
        balances,
        sequenceNumber: account.sequenceNumber(),
      };

      this.logger.log(
        `Successfully fetched ${balances.length} balance(s) for account: ${publicKey}`,
      );

      return result;
    } catch (error: unknown) {
      return this.handleError(error, publicKey);
    }
  }

  /**
   * Checks if Horizon API is available and responsive
   * @returns Promise<boolean> - true if Horizon is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      // Try to fetch the root endpoint
      await this.server.root();
      return true;
    } catch (error) {
      this.logger.warn(
        `Horizon health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Maps Horizon balance objects to DTOs
   * Optimized to reduce repeated type checks
   */
  private mapBalancesToDto(
    balances: Horizon.AccountResponse['balances'],
  ): AssetBalanceDto[] {
    return balances.map((balance: Horizon.HorizonApi.BalanceLine) => {
      const assetType = balance.asset_type;
      const isLiquidityPool = assetType === 'liquidity_pool_shares';
      const isCreditAsset =
        assetType === 'credit_alphanum4' || assetType === 'credit_alphanum12';

      const assetBalance: AssetBalanceDto = {
        assetType,
        balance: balance.balance,
      };

      // Add asset code and issuer for credit assets (single check)
      if (isCreditAsset) {
        assetBalance.assetCode = (
          balance as Horizon.HorizonApi.BalanceLineAsset
        ).asset_code;
        assetBalance.assetIssuer = (
          balance as Horizon.HorizonApi.BalanceLineAsset
        ).asset_issuer;
      }

      // Add optional fields if present (only for non-liquidity pool balances)
      if (!isLiquidityPool) {
        if (
          'limit' in balance &&
          (balance as Horizon.HorizonApi.BalanceLineAsset).limit
        ) {
          assetBalance.limit = (
            balance as Horizon.HorizonApi.BalanceLineAsset
          ).limit;
        }

        if (
          'buying_liabilities' in balance &&
          (balance as Horizon.HorizonApi.BalanceLineAsset).buying_liabilities
        ) {
          assetBalance.buyingLiabilities = (
            balance as Horizon.HorizonApi.BalanceLineAsset
          ).buying_liabilities;
        }

        if (
          'selling_liabilities' in balance &&
          (balance as Horizon.HorizonApi.BalanceLineAsset).selling_liabilities
        ) {
          assetBalance.sellingLiabilities = (
            balance as Horizon.HorizonApi.BalanceLineAsset
          ).selling_liabilities;
        }
      }

      return assetBalance;
    });
  }

  /**
   * Handles errors from Horizon API calls
   * Optimized error handling with early returns
   */
  private handleError(error: unknown, publicKey: string): never {
    // Handle known error types first (most common cases)
    if (error instanceof NotFoundError) {
      this.logger.warn(`Account not found: ${publicKey}`);
      throw new AccountNotFoundException(publicKey);
    }

    if (error instanceof NetworkError) {
      this.logger.error(
        `Network error fetching account balances for ${publicKey}:`,
        error.message,
      );
      throw new HorizonUnavailableException(
        this.config.horizonUrl,
        error.message,
      );
    }

    // Handle HTTP errors (check once)
    const errorObj = error as {
      response?: { status?: number };
      message?: string;
    };
    const status = errorObj?.response?.status;

    if (status === 404) {
      this.logger.warn(`Account not found: ${publicKey}`);
      throw new AccountNotFoundException(publicKey);
    }

    if (status && status >= 500) {
      this.logger.error(
        `Horizon API error (${status}) for account ${publicKey}:`,
        errorObj.message || 'Unknown error',
      );
      throw new HorizonUnavailableException(
        this.config.horizonUrl,
        `HTTP ${status}: ${errorObj.message || 'Server error'}`,
      );
    }

    // Handle unknown errors (fallback)
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : String(error);

    this.logger.error(
      `Unexpected error fetching account balances for ${publicKey}:`,
      errorStack,
    );

    throw new HorizonUnavailableException(this.config.horizonUrl, errorMessage);
  }
}
