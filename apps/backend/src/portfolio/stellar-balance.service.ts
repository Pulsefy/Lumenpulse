import { Injectable, Logger, Inject } from '@nestjs/common';
import { PriceService } from '../price/price.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const StellarSdk = require('stellar-sdk');

export interface StellarBalance {
  assetCode: string;
  assetIssuer: string | null;
  balance: string;
}

interface BalanceLine {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

@Injectable()
export class StellarBalanceService {
  private readonly logger = new Logger(StellarBalanceService.name);

  private readonly server: any;

  constructor(
    @Inject(PriceService) private readonly priceService: PriceService,
  ) {
    // Use public Stellar Horizon server
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this.server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
  }

  /**
   * Fetch account balances from Stellar network
   */
  async getAccountBalances(publicKey: string): Promise<StellarBalance[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const account = await this.server.loadAccount(publicKey);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const balances: BalanceLine[] = account.balances;

      return balances
        .map((balance: BalanceLine) => {
          if (balance.asset_type === 'native') {
            return {
              assetCode: 'XLM',
              assetIssuer: null,
              balance: balance.balance,
            };
          } else if (balance.asset_code && balance.asset_issuer) {
            return {
              assetCode: balance.asset_code,
              assetIssuer: balance.asset_issuer,
              balance: balance.balance,
            };
          }
          return null;
        })
        .filter((b: StellarBalance | null): b is StellarBalance => b !== null);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to fetch balances for ${publicKey}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Get USD value for an asset.
   * Fetches real-time price from PriceService.
   */
  async getAssetValueUsd(
    assetCode: string,
    assetIssuer: string | null,
    amount: string,
  ): Promise<number> {
    let price = 0;
    try {
      price = await this.priceService.getCurrentPrice(assetCode);
    } catch (error) {
      this.logger.warn(
        `Failed to fetch price for ${assetCode}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
    const numAmount = parseFloat(amount);
    return numAmount * price;
  }

  /**
   * Batch-compute USD values for multiple asset balances in a single
   * price fetch instead of calling `getAssetValueUsd()` once per asset.
   *
   * Replaces the N+1 pattern:
   *   `await Promise.all(balances.map(b => getAssetValueUsd(...)))`
   *
   * @param assets Array of balance descriptors.
   * @returns Array of `{ ...asset, valueUsd }` in the same order.
   */
  async getAssetValuesUsd(
    assets: Array<{
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
    }>,
  ): Promise<
    Array<{
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
      valueUsd: number;
    }>
  > {
    if (assets.length === 0) return [];

    // Single batched price lookup – O(1) round-trips regardless of asset count.
    const assetCodes = assets.map((a) => a.assetCode);
    let priceMap: Map<string, number>;
    try {
      priceMap = await this.priceService.getPricesForAssets(assetCodes);
    } catch (error) {
      this.logger.warn(
        `Failed to batch-fetch prices: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      priceMap = new Map();
    }

    return assets.map((asset) => {
      const price = priceMap.get(asset.assetCode) ?? 0;
      const valueUsd = parseFloat(asset.amount) * price;
      return { ...asset, valueUsd };
    });
  }
}
