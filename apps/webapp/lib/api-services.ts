// API service functions for cryptocurrency and news data

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

export interface NewsApiData {
  title: string;
  description: string;
  url: string;
  urlToImage: string;
  publishedAt: string;
  source: {
    name: string;
  };
  author?: string;
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

// NewsAPI service with hardcoded API key
export class NewsApiService {
  // Your NewsAPI key hardcoded - no .env needed!
  private static readonly NEWS_API_KEY = '2337f3f8a0e7479da03bf070dfce37b9';
  private static readonly BASE_URL = 'https://newsapi.org/v2';
  
  static async getCryptoNews(pageSize: number = 10): Promise<NewsApiData[]> {
    try {
      const query = 'cryptocurrency OR bitcoin OR ethereum OR blockchain OR crypto';
      const response = await fetch(
        `${this.BASE_URL}/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${pageSize}&language=en`,
        {
          headers: {
            'Authorization': `Bearer ${this.NEWS_API_KEY}`,
            'Accept': 'application/json',
          },
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      return data.articles || [];
    } catch (error) {
      console.error('Error fetching news data:', error);
      throw new Error('Failed to fetch news data. Please try again later.');
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

export const transformNewsData = (apiData: NewsApiData, index: number) => ({
  id: index + 1,
  title: apiData.title,
  excerpt: apiData.description || 'No description available',
  category: 'Crypto',
  author: apiData.author || apiData.source.name,
  date: new Date(apiData.publishedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }),
  imageUrl: apiData.urlToImage || 'https://picsum.photos/seed/crypto/800/450',
});
