import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';
import { CorrelationService } from '../common/correlation/correlation.service';

interface ExchangeRateResponse {
  rates: { [key: string]: number };
}

interface CoingeckoResponse {
  [key: string]: { [key: string]: number };
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly correlationService: CorrelationService,
  ) {}

  /**
   * Fetch exchange rate between two currencies
   */
  async getExchangeRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) {
      return 1;
    }

    try {
      // Primary source: CoinGecko
      return await this.fetchFromCoingecko(fromCurrency, toCurrency);
    } catch (error: unknown) {
      this.logger.warn(
        `CoinGecko API failed, falling back to alternative: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      // Fallback source: ExchangeRate-API
      return await this.fetchFromExchangeRateApi(fromCurrency, toCurrency);
    }
  }

  /**
   * Primary: Fetch exchange rates from CoinGecko
   */
  private async fetchFromCoingecko(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    try {
      const response = await this.httpService
        .get<CoingeckoResponse>(
          `https://api.coingecko.com/api/v3/simple/price`,
          {
            params: {
              ids: this.mapCurrencyToCoingeckoId(fromCurrency),
              vs_currencies: this.mapCurrencyToCoingeckoId(toCurrency),
            },
            headers: {
              ...(this.correlationService.getCorrelationId() && {
                [REQUEST_ID_HEADER]: this.correlationService.getCorrelationId(),
              }),
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
        {
          headers: {
            ...(this.correlationService.getCorrelationId() && {
              [REQUEST_ID_HEADER]: this.correlationService.getCorrelationId(),
            }),
          },
        },
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
