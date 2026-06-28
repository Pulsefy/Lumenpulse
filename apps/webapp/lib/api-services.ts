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

