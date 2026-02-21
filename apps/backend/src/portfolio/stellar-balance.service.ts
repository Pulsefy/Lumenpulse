import { Injectable, Logger } from '@nestjs/common';
import { Horizon } from 'stellar-sdk';

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
  private readonly server: Horizon.Server;

  constructor() {
    // Use public Stellar Horizon server
    this.server = new Horizon.Server('https://horizon.stellar.org');
  }

  /**
   * Fetch account balances from Stellar network
   */
  async getAccountBalances(publicKey: string): Promise<StellarBalance[]> {
    try {
      // Use proper Horizon.AccountResponse type if possible, but for now we keep it simple
      const account = await this.server.loadAccount(publicKey);

      // Cast balances to our expected type
      const balances = account.balances as unknown as BalanceLine[];

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
   * Get USD value for an asset (mock implementation)
   * In production, this should call a price API like CoinGecko or similar
   */
  getAssetValueUsd(
    assetCode: string,
    assetIssuer: string | null,
    amount: string,
  ): number {
    // Mock prices for demonstration
    const mockPrices: Record<string, number> = {
      XLM: 0.12, // $0.12 per XLM
      USDC: 1.0, // $1.00 per USDC
      BTC: 45000.0, // Mock BTC price
    };

    const price = mockPrices[assetCode] || 0;
    const numAmount = parseFloat(amount);

    return numAmount * price;
  }
}
