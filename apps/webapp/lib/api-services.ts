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
