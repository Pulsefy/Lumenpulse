import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CacheService } from '../cache/cache.service';
import {
  DEFAULT_TTLS,
  EXCHANGE_RATE_CACHE_PREFIX,
} from '../cache/cache.constants';

export type SupportedCurrency = 'USD' | 'EUR' | 'GBP' | 'NGN' | 'XLM';

interface ExchangeRateResponse {
  rates: {
    [key: string]: number;
  };
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private readonly CACHE_TTL_MS = DEFAULT_TTLS.exchangeRate;

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
    const normalizedFrom = fromCurrency.toUpperCase();
    const normalizedTo = toCurrency.toUpperCase();
    if (normalizedFrom === normalizedTo) {
      return 1;
    }

    const cacheKey = `${EXCHANGE_RATE_CACHE_PREFIX}:${normalizedFrom}_${normalizedTo}`;

    return this.cacheService.getOrSet(
      cacheKey,
      async () => {
        try {
          // Use CoinGecko free API for cryptocurrency and fiat exchange rates.
          return await this.fetchFromCoinGecko(normalizedFrom, normalizedTo);
        } catch (error) {
          this.logger.error(
            `Failed to fetch exchange rate ${normalizedFrom}/${normalizedTo}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          throw new Error(
            `Unable to fetch exchange rate for ${normalizedFrom}/${normalizedTo}`,
          );
        }
      },
      this.CACHE_TTL_MS,
    );
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
