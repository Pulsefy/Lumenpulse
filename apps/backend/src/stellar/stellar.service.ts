import { Injectable, Logger, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  Horizon,
  NetworkError,
  NotFoundError,
  StrKey,
} from '@stellar/stellar-sdk';
import { AccountBalancesDto, AssetBalanceDto } from './dto/balance.dto';
import {
  AssetDiscoveryQueryDto,
  AssetDiscoveryResponseDto,
  AssetDto,
} from './dto/asset-discovery.dto';
import stellarConfig, { StellarConfig } from './config/stellar.config';
import {
  AccountNotFoundException,
  HorizonUnavailableException,
  InvalidPublicKeyException,
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
   * Validates a Stellar public key format
   * @param publicKey The public key to validate
   * @returns boolean indicating if the key is valid
   */
  validatePublicKey(publicKey: string): boolean {
    try {
      return StrKey.isValidEd25519PublicKey(publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Validates and throws an exception if invalid
   * @param publicKey The public key to validate
   * @throws InvalidPublicKeyException if the key is invalid
   */
  validatePublicKeyOrThrow(publicKey: string): void {
    if (!this.validatePublicKey(publicKey)) {
      throw new InvalidPublicKeyException(publicKey);
    }
  }

  /**
   * Gets basic account info without balances (lightweight)
   * @param publicKey The Stellar public key
   * @returns Account exists or not
   */
  async accountExists(publicKey: string): Promise<boolean> {
    try {
      this.validatePublicKeyOrThrow(publicKey);
      await this.server.loadAccount(publicKey);
      return true;
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof InvalidPublicKeyException
      ) {
        return false;
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.debug(
        `Error checking account existence for ${publicKey}: ${errorMessage}`,
      );
      return false;
    }
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
        (error: unknown) => {
          if (error instanceof NetworkError) {
            return true;
          }
          if (error instanceof NotFoundError) {
            return false;
          }

          interface ErrorWithResponse {
            response?: { status?: number };
          }

          const errorObj = error as ErrorWithResponse;
          const status = errorObj?.response?.status;
          return status !== 404 && (status === undefined || status >= 500);
        },
      );

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
   * Gets account information with balances (alias for getAccountBalances for backward compatibility)
   * @param publicKey The Stellar public key
   * @returns Account information or null if not found
   */
  async getAccountInfo(publicKey: string): Promise<AccountBalancesDto | null> {
    try {
      return await this.getAccountBalances(publicKey);
    } catch (error: unknown) {
      // Return null for expected errors, throw for unexpected ones
      if (
        error instanceof AccountNotFoundException ||
        error instanceof InvalidPublicKeyException
      ) {
        return null;
      }
      // For Horizon unavailability, log and return null instead of throwing
      if (error instanceof HorizonUnavailableException) {
        this.logger.warn(
          `Horizon unavailable when fetching account ${publicKey}`,
        );
        return null;
      }
      throw error;
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
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Horizon health check failed: ${errorMessage}`);
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

      if (isCreditAsset) {
        const creditBalance = balance as Horizon.HorizonApi.BalanceLineAsset;
        assetBalance.assetCode = creditBalance.asset_code;
        assetBalance.assetIssuer = creditBalance.asset_issuer;
      }

      if (!isLiquidityPool) {
        const creditBalance = balance as Horizon.HorizonApi.BalanceLineAsset;

        if ('limit' in balance && creditBalance.limit) {
          assetBalance.limit = creditBalance.limit;
        }

        if (
          'buying_liabilities' in balance &&
          creditBalance.buying_liabilities
        ) {
          assetBalance.buyingLiabilities = creditBalance.buying_liabilities;
        }

        if (
          'selling_liabilities' in balance &&
          creditBalance.selling_liabilities
        ) {
          assetBalance.sellingLiabilities = creditBalance.selling_liabilities;
        }
      }

      return assetBalance;
    });
  }

  /**
   * Discovers Stellar assets based on search criteria
   *
   * @param query - Asset discovery query parameters
   * @returns Promise<AssetDiscoveryResponseDto> - Asset discovery results with pagination
   * @throws HorizonUnavailableException if Horizon API is unavailable
   */
  async discoverAssets(
    query: AssetDiscoveryQueryDto,
  ): Promise<AssetDiscoveryResponseDto> {
    this.logger.debug(`Discovering assets with query:`, query);

    try {
      const limit = Math.min(query.limit || 10, 100); // Cap at 100 for safety
      let assetsBuilder = this.server.assets();

      // Apply filters based on query parameters
      // Note: Stellar SDK doesn't support filtering by asset code alone
      // We'll filter the results after fetching them
      if (query.issuer) {
        assetsBuilder = assetsBuilder.forIssuer(query.issuer);
      }

      // Apply cursor if provided
      if (query.cursor) {
        assetsBuilder = assetsBuilder.cursor(query.cursor);
      }

      // Apply limit
      assetsBuilder = assetsBuilder.limit(limit);

      // Execute the query with retry logic
      const assetsResponse = await retryWithBackoff(
        () => assetsBuilder.call(),
        this.config.retryAttempts,
        this.config.retryDelay,
        (error) => {
          // Retry on network errors and server errors
          if (error instanceof NetworkError) {
            return true;
          }
          const errorObj = error as { response?: { status?: number } };
          const status = errorObj?.response?.status;
          return status === undefined || status >= 500;
        },
      );

      // Map results to DTOs
      let assets = assetsResponse.records.map((record) =>
        this.mapAssetToDto(record),
      );

      // Apply additional filtering if needed
      if (query.assetCode && !query.issuer) {
        const searchTerm = query.assetCode.toLowerCase();
        assets = assets.filter(
          (asset) => asset.assetCode.toLowerCase() === searchTerm,
        );
      }

      // Filter by partial match if 'q' parameter is provided
      if (query.q) {
        const searchTerm = query.q.toLowerCase();
        assets = assets.filter((asset) =>
          asset.assetCode.toLowerCase().includes(searchTerm),
        );
      }

      const response: AssetDiscoveryResponseDto = {
        assets,
        hasMore: !!assetsResponse.next,
        nextCursor: assetsResponse.next
          ? (assetsResponse.next as unknown as string)
          : undefined,
      };

      this.logger.log(
        `Successfully discovered ${assets.length} asset(s) for query:`,
        query,
      );

      return response;
    } catch (error: unknown) {
      return this.handleAssetDiscoveryError(error);
    }
  }

  /**
   * Maps Horizon asset records to DTOs
   */

  private mapAssetToDto(record: any): AssetDto {
    const asset: AssetDto = {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      assetCode: record.asset_code as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      assetIssuer: record.asset_issuer as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      assetType: record.asset_type as string,
    };

    // Add optional fields if present
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (record.num_accounts !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      asset.numAccounts = record.num_accounts as number;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (record.amount !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      asset.totalSupply = record.amount as string;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (record.flags) {
      asset.flags = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        authRequired: !!record.flags.auth_required,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        authRevocable: !!record.flags.auth_revocable,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        authImmutable: !!record.flags.auth_immutable,
      };
    }

    return asset;
  }

  /**
   * Handles errors from asset discovery calls
   */
  private handleAssetDiscoveryError(error: unknown): never {
    if (error instanceof NetworkError) {
      this.logger.error(`Network error during asset discovery:`, error.message);
      throw new HorizonUnavailableException(
        this.config.horizonUrl,
        error.message,
      );
    }

    // Handle HTTP errors
    const errorObj = error as {
      response?: { status?: number };
      message?: string;
    };
    const status = errorObj?.response?.status;

    if (status && status >= 500) {
      this.logger.error(
        `Horizon API error (${status}) during asset discovery:`,
        errorObj.message || 'Unknown error',
      );
      throw new HorizonUnavailableException(
        this.config.horizonUrl,
        `HTTP ${status}: ${errorObj.message || 'Server error'}`,
      );
    }

    // Handle unknown errors
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    this.logger.error(`Unexpected error during asset discovery:`, errorMessage);

    throw new HorizonUnavailableException(this.config.horizonUrl, errorMessage);
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

    interface ErrorWithResponse {
      response?: { status?: number };
      message?: string;
    }

    const errorObj = error as ErrorWithResponse;
    const status = errorObj?.response?.status;

    if (status === 404) {
      this.logger.warn(`Account not found: ${publicKey}`);
      throw new AccountNotFoundException(publicKey);
    }

    if (status && status >= 500) {
      const errorMessage = errorObj.message || 'Unknown error';
      this.logger.error(
        `Horizon API error (${status}) for account ${publicKey}:`,
        errorMessage,
      );
      throw new HorizonUnavailableException(
        this.config.horizonUrl,
        `HTTP ${status}: ${errorMessage}`,
      );
    }

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
