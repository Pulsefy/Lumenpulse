import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CacheService } from '../cache/cache.service';

export type SupportedCurrency = 'USD' | 'EUR' | 'GBP' | 'NGN' | 'XLM';

interface ExchangeRateResponse {
  rates: {
    [key: string]: number;
  };
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly EXCHANGE_RATE_CACHE_PREFIX = 'exchange-rates';
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  private readonly supportedCurrencies: SupportedCurrency[] = [
    'USD',
    'EUR',
    'GBP',
    'NGN',
    'XLM',
  ];

  constructor(
    private readonly httpService: HttpService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Get exchange rate from one currency to another
   */
  async getExchangeRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    const cacheKey = `${this.EXCHANGE_RATE_CACHE_PREFIX}:${fromCurrency}_${toCurrency}`;

    // Check cache first
    const cached = await this.cacheService.get<number>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      // Use CoinGecko free API for cryptocurrency and fiat exchange rates
      const rate = await this.fetchFromCoinGecko(fromCurrency, toCurrency);

      // Cache the result
      await this.cacheService.set(cacheKey, rate, this.CACHE_TTL_MS);

      return rate;
    } catch (error) {
      this.logger.error(
        `Failed to fetch exchange rate ${fromCurrency}/${toCurrency}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new Error(
        `Unable to fetch exchange rate for ${fromCurrency}/${toCurrency}`,
      );
    }
  }

  /**
   * Convert amount from one currency to another
   */
  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    const rate = await this.getExchangeRate(fromCurrency, toCurrency);
    return Math.round(amount * rate * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): SupportedCurrency[] {
    return this.supportedCurrencies;
  }

  /**
   * Validate if currency is supported
   */
  isSupportedCurrency(currency: string): currency is SupportedCurrency {
    return this.supportedCurrencies.includes(currency as SupportedCurrency);
  }

  /**
   * Fetch exchange rates from CoinGecko API
   */
  private async fetchFromCoinGecko(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    try {
      // CoinGecko free API endpoint for cryptocurrency prices
      const response = await this.httpService
        .get<ExchangeRateResponse>(
          `https://api.coingecko.com/api/v3/simple/price`,
          {
            params: {
              ids: this.mapCurrencyToCoingeckoId(fromCurrency),
              vs_currencies: this.mapCurrencyToCoingeckoId(toCurrency),
            },
          },
        )
        .toPromise();

      const data = response?.data;
      if (!data) {
        throw new Error('Empty response from CoinGecko');
      }

      const toId = this.mapCurrencyToCoingeckoId(toCurrency);

      const rate = data.rates[toId];

      if (rate === undefined || rate === null) {
        throw new Error(
          `No exchange rate found for ${fromCurrency} to ${toCurrency}`,
        );
      }

      return rate;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(`CoinGecko API fallback: ${errorMessage}`);

      // Fallback to simple exchange rate API
      return this.fetchFromExchangeRateApi(fromCurrency, toCurrency);
    }
  }

  /**
   * Fallback: Fetch exchange rates from ExchangeRate-API
   */
  private async fetchFromExchangeRateApi(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    // Use fixer.io or similar free API as fallback
    // For free tier, we'll use a simple fetch approach
    const response = await this.httpService
      .get<ExchangeRateResponse>(
        `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`,
      )
      .toPromise();

    const data = response?.data;
    if (!data || !data.rates || !data.rates[toCurrency]) {
      throw new Error(
        `Unable to fetch rate from ${fromCurrency} to ${toCurrency}`,
      );
    }

    return data.rates[toCurrency];
  }

  /**
   * Map currency codes to CoinGecko IDs
   */
  private mapCurrencyToCoingeckoId(currency: string): string {
    const mapping: { [key: string]: string } = {
      XLM: 'stellar',
      USD: 'usd',
      EUR: 'eur',
      GBP: 'gbp',
      NGN: 'ngn',
    };
    return mapping[currency.toUpperCase()] || currency.toLowerCase();
  }
}
