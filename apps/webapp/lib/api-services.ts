// API service functions for cryptocurrency data

export interface CryptoApiData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  total_volume: number;
  market_cap: number;
  sparkline_in_7d?: {
    price: number[];
  };
}

// CoinGecko API service (No API key needed)
export class CryptoApiService {
  private static readonly BASE_URL = 'https://api.coingecko.com/api/v3';
  
  static async getTopCryptocurrencies(limit: number = 20): Promise<CryptoApiData[]> {
    try {
      const response = await fetch(
        `${this.BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching cryptocurrency data:', error);
      throw new Error('Failed to fetch cryptocurrency data. Please try again later.');
    }
  }
}

// Data transformation utilities
export const transformCryptoData = (apiData: CryptoApiData, index: number) => ({
  id: index + 1,
  name: apiData.name,
  symbol: apiData.symbol.toUpperCase(),
  icon: apiData.image,
  price: apiData.current_price,
  change1h: apiData.price_change_percentage_1h_in_currency || 0,
  change24h: apiData.price_change_percentage_24h || 0,
  change7d: apiData.price_change_percentage_7d_in_currency || 0,
  volume24h: apiData.total_volume,
  marketCap: apiData.market_cap,
  sparkline: apiData.sparkline_in_7d?.price?.slice(-15) || Array(15).fill(50),
});

export interface StellarBalance {
  assetType: string;
  balance: string;
  assetCode?: string;
  assetIssuer?: string;
}

export class StellarApiService {
  private static readonly BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  static async getAccountBalances(publicKey: string): Promise<{ balances: StellarBalance[] }> {
    try {
      const response = await fetch(`${this.BASE_URL}/stellar/accounts/${publicKey}/balances`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        // Unfunded/empty account: return 0 XLM balance
        return {
          balances: [
            {
              assetType: 'native',
              balance: '0.0000000',
            },
          ],
        };
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching Stellar balances:', error);
      throw error;
    }
  }

  static async getAccountTransactions(publicKey: string, limit: number = 5): Promise<any[]> {
    try {
      const response = await fetch(`${this.BASE_URL}/stellar/accounts/${publicKey}/transactions?limit=${limit}`, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        // Empty transactions for unfunded/empty account
        return [];
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data || [];
    } catch (error) {
      console.error('Error fetching Stellar transactions:', error);
      return []; // Return empty array on transaction fetch error to fail gracefully
    }
  }

  private static getAuthHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return {};
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  static async getChallenge(publicKey: string): Promise<{ challenge: string }> {
    const response = await fetch(`${this.BASE_URL}/auth/challenge?publicKey=${publicKey}`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to get auth challenge');
    }

    return response.json();
  }

  static async linkAccount(publicKey: string, signedChallenge: string, label?: string): Promise<any> {
    const response = await fetch(`${this.BASE_URL}/users/me/accounts`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        publicKey,
        signedChallenge,
        label,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to link Stellar account');
    }

    return response.json();
  }
}

// ---------------------------------------------------------------------------
// Portfolio API — interfaces mirroring backend DTOs
// ---------------------------------------------------------------------------

export interface AssetBalanceWithCurrency {
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  /** Value in the requested currency */
  value: number;
  valueUsd: number;
}

export interface PortfolioSummaryResponse {
  /** Total portfolio value in the requested currency */
  totalValue: string;
  currency: string;
  totalValueUsd: string;
  assets: AssetBalanceWithCurrency[];
  /** ISO timestamp of last recorded snapshot, or null for first-time users */
  lastUpdated: string | null;
  hasLinkedAccount: boolean;
  exchangeRate: number;
}

export interface TimeWindowPerformance {
  window: '24h' | '7d' | '30d';
  hasData: boolean;
  absolutePnl: number | null;
  percentageChange: number | null;
  currentValueUsd: number;
  baselineValueUsd: number | null;
  baselineDate: string | null;
}

export interface PortfolioPerformanceResponse {
  userId: string;
  currentValueUsd: number;
  calculatedAt: string;
  windows: TimeWindowPerformance[];
}

export interface AllocationAsset {
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  valueUsd: number;
  percentage: number;
}

export class PortfolioApiService {
  private static readonly BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  /** Read the JWT from the auth-token cookie (same pattern as StellarApiService). */
  private static getAuthHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return { 'Content-Type': 'application/json' };
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * Returns true when an auth token cookie is present.
   * Used by the hook to skip fetching for unauthenticated visitors.
   */
  static isAuthenticated(): boolean {
    if (typeof document === 'undefined') return false;
    return document.cookie.split('; ').some((row) => row.startsWith('auth-token='));
  }

  /**
   * GET /portfolio/summary
   * Latest portfolio snapshot with total value and per-asset balances.
   */
  static async getSummary(
    currency = 'USD',
    signal?: AbortSignal,
  ): Promise<PortfolioSummaryResponse> {
    const response = await fetch(
      `${this.BASE_URL}/portfolio/summary?currency=${encodeURIComponent(currency)}`,
      { headers: this.getAuthHeaders(), signal },
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).message || `Portfolio summary fetch failed (${response.status})`);
    }
    return response.json();
  }

  /**
   * GET /portfolio/performance
   * 24h / 7d / 30d performance windows with absolute and percentage PnL.
   */
  static async getPerformance(
    signal?: AbortSignal,
  ): Promise<PortfolioPerformanceResponse> {
    const response = await fetch(`${this.BASE_URL}/portfolio/performance`, {
      headers: this.getAuthHeaders(),
      signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).message || `Portfolio performance fetch failed (${response.status})`);
    }
    return response.json();
  }

  /**
   * GET /portfolio/allocation
   * Asset allocation breakdown with percentage per asset.
   */
  static async getAllocation(
    signal?: AbortSignal,
  ): Promise<AllocationAsset[]> {
    const response = await fetch(`${this.BASE_URL}/portfolio/allocation`, {
      headers: this.getAuthHeaders(),
      signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).message || `Portfolio allocation fetch failed (${response.status})`);
    }
    return response.json();
  }
}

