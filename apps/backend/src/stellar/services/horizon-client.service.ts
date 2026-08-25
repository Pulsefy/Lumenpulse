import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import { RequestContextService } from '../../common/services/request-context.service';

export interface HorizonTransaction {
  id: string;
  created_at: string;
  successful: boolean;
  memo?: string;
  fee_charged?: string;
}

export interface HorizonOperation {
  id: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  source_account: string;
  from?: string;
  to?: string;
  into?: string;
  amount?: string;
  amount_charged?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  starting_balance?: string;
  funder?: string;
  account?: string;
  trustor?: string;
  trustee?: string;
  limit?: string;
  offer_id?: string;
  buying_asset_code?: string;
  selling_asset_code?: string;
  buying_asset_type?: string;
  selling_asset_type?: string;
  [key: string]: unknown;
}

export interface HorizonTransactionsResponse {
  _embedded: {
    records: HorizonTransaction[];
  };
  _links: {
    next?: {
      href: string;
    };
  };
}

export interface HorizonOperationsResponse {
  _embedded?: {
    records: HorizonOperation[];
  };
}

export interface HorizonErrorResponse {
  detail?: string;
  title?: string;
  status?: number;
}

function getErrorStatus(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    'status' in error &&
    (typeof (error as { status: unknown }).status === 'number' ||
      typeof (error as { status: unknown }).status === 'string')
  ) {
    const status = (error as { status: number | string }).status;
    return String(status);
  }
  return undefined;
}

/**
 * HorizonClientService
 *
 * Centralized HTTP client for Stellar Horizon API calls with:
 * - Request correlation ID propagation
 * - Latency metrics (Prometheus histograms)
 * - Error tracking (Prometheus counters)
 * - Structured logging with requestId
 *
 * All outbound Horizon calls should use this service instead of raw fetch().
 */
@Injectable()
export class HorizonClientService {
  private readonly logger = new Logger(HorizonClientService.name);
  private readonly horizonUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly requestContextService: RequestContextService,
  ) {
    const network = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );
    this.horizonUrl =
      network === 'testnet'
        ? 'https://horizon-testnet.stellar.org'
        : 'https://horizon.stellar.org';

    this.logger.log(
      `HorizonClientService initialized with URL: ${this.horizonUrl}`,
    );
  }

  /**
   * Fetch transaction history for a Stellar account
   */
  async getTransactions(
    publicKey: string,
    limit: number = 50,
    cursor?: string,
  ): Promise<{ transactions: HorizonTransaction[]; nextPage?: string }> {
    const method = 'getTransactions';
    const requestId = this.requestContextService.getRequestId();

    let url = `${this.horizonUrl}/accounts/${publicKey}/transactions?order=desc&limit=${limit}`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    this.logger.log(
      { requestId, method, publicKey, limit, cursor },
      'Fetching transactions from Horizon',
    );

    const startTime = Date.now();
    try {
      const response = await this.instrumentedFetch(url, method);
      const data = (await response.json()) as
        HorizonTransactionsResponse | HorizonErrorResponse;

      if (!response.ok) {
        const errorDetail = (data as HorizonErrorResponse).detail;
        const errorMessage = errorDetail || 'Failed to fetch transactions';
        this.metricsService.recordHorizonError(method, String(response.status));
        this.logger.error(
          { requestId, method, status: response.status, error: errorMessage },
          'Horizon API error',
        );
        throw new Error(errorMessage);
      }

      const horizonData = data as HorizonTransactionsResponse;
      let nextPage: string | undefined;

      if (horizonData._links?.next?.href) {
        const nextUrl = new URL(horizonData._links.next.href);
        nextPage = nextUrl.searchParams.get('cursor') || undefined;
      }

      this.logger.log(
        {
          requestId,
          method,
          count: horizonData._embedded.records.length,
          durationMs: Date.now() - startTime,
        },
        'Successfully fetched transactions',
      );

      return {
        transactions: horizonData._embedded.records,
        nextPage,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.metricsService.recordHorizonError(
        method,
        getErrorStatus(error) ?? 'NETWORK_ERROR',
      );

      this.logger.error(
        { requestId, method, durationMs, error: errorMessage },
        'Failed to fetch transactions from Horizon',
      );

      throw error;
    } finally {
      const durationMs = Date.now() - startTime;
      this.metricsService.recordHorizonRequest(method, 'success', durationMs);
    }
  }

  /**
   * Fetch operations for a specific transaction
   */
  async getOperations(transactionId: string): Promise<HorizonOperation[]> {
    const method = 'getOperations';
    const requestId = this.requestContextService.getRequestId();
    const url = `${this.horizonUrl}/transactions/${transactionId}/operations`;

    this.logger.log(
      { requestId, method, transactionId },
      'Fetching operations from Horizon',
    );

    const startTime = Date.now();
    try {
      const response = await this.instrumentedFetch(url, method);
      const data = (await response.json()) as HorizonOperationsResponse;

      if (!response.ok) {
        this.metricsService.recordHorizonError(method, String(response.status));
        this.logger.error(
          { requestId, method, status: response.status, transactionId },
          'Failed to fetch operations',
        );
        return [];
      }

      const operations = data._embedded?.records || [];

      this.logger.log(
        {
          requestId,
          method,
          transactionId,
          count: operations.length,
          durationMs: Date.now() - startTime,
        },
        'Successfully fetched operations',
      );

      return operations;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.metricsService.recordHorizonError(
        method,
        getErrorStatus(error) ?? 'NETWORK_ERROR',
      );

      this.logger.error(
        { requestId, method, transactionId, durationMs, error: errorMessage },
        'Failed to fetch operations from Horizon',
      );

      return [];
    } finally {
      const durationMs = Date.now() - startTime;
      this.metricsService.recordHorizonRequest(method, 'success', durationMs);
    }
  }

  /**
   * Execute a fetch request with instrumentation
   */
  private async instrumentedFetch(
    url: string,
    method: string,
    options?: RequestInit,
  ): Promise<Response> {
    const requestId = this.requestContextService.getRequestId();
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options?.headers,
          'X-Request-Id': requestId,
          'Content-Type': 'application/json',
        },
      });

      const durationMs = Date.now() - startTime;
      this.logger.debug(
        {
          requestId,
          method,
          url: new URL(url).pathname,
          status: response.status,
          durationMs,
        },
        'Horizon API call completed',
      );

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.metricsService.recordHorizonError(method, 'NETWORK_ERROR');

      this.logger.error(
        {
          requestId,
          method,
          url: new URL(url).pathname,
          durationMs,
          error: errorMessage,
        },
        'Horizon API network error',
      );

      throw error;
    }
  }
}
