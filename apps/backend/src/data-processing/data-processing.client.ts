import { HttpService } from '@nestjs/axios';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse, isAxiosError } from 'axios';
import { Counter, Gauge } from 'prom-client';
import { defer, firstValueFrom, Observable, timeout, TimeoutError } from 'rxjs';
import { config } from '../lib/config';
import { MetricsService } from '../metrics/metrics.service';
import { RequestContextService } from '../common/services/request-context.service';
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from '../common/constants/request.constants';

export class DataProcessingUnavailableError extends ServiceUnavailableException {
  constructor(
    public readonly reason: 'timeout' | 'unavailable' | 'circuit_open',
  ) {
    super({
      code: 'DATA_PROCESSING_UNAVAILABLE',
      message: 'Data-processing service is unavailable',
      details: { reason },
    });
  }
}

export interface DataProcessingRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  /** Disable retries for probes with a strict latency budget. */
  retry?: false;
}

@Injectable()
export class DataProcessingClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private failures = 0;
  private openedAt = 0;
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private generation = 0;
  private readonly outcomes: Counter<'method' | 'outcome'>;
  private readonly breaker: Gauge;

  constructor(
    private readonly http: HttpService,
    settings: ConfigService,
    metrics: MetricsService,
  ) {
    this.baseUrl = (
      settings.get<string>('PYTHON_API_URL') || config.python.apiUrl
    ).replace(/\/$/, '');
    this.apiKey =
      settings.get<string>('PYTHON_API_KEY') || config.python.apiKey || '';
    const number = (
      key: string,
      fallback: number,
      min: number,
      max: number,
    ): number => {
      const raw = settings.get<string | number>(key);
      const value = raw === undefined ? fallback : Number(raw);
      return Number.isInteger(value) && value >= min && value <= max
        ? value
        : fallback;
    };
    this.timeoutMs = number('PYTHON_CLIENT_TIMEOUT_MS', 10_000, 1, 300_000);
    this.retries = number('PYTHON_CLIENT_MAX_RETRIES', 2, 0, 5);
    this.failureThreshold = number(
      'PYTHON_CLIENT_FAILURE_THRESHOLD',
      5,
      1,
      100,
    );
    this.resetMs = number('PYTHON_CLIENT_RESET_MS', 30_000, 1, 300_000);
    this.outcomes = new Counter({
      name: 'data_processing_requests_total',
      help: 'Python client attempts and outcomes',
      labelNames: ['method', 'outcome'],
      registers: [metrics.registry],
    });
    this.breaker = new Gauge({
      name: 'data_processing_breaker_state',
      help: 'Python breaker: 0 closed, 1 open, 2 half-open',
      registers: [metrics.registry],
    });
    this.breaker.set(0);
  }

  get<T>(
    path: string,
    options: DataProcessingRequestOptions = {},
  ): Observable<AxiosResponse<T>> {
    return defer(() => this.request<T>('GET', path, undefined, options));
  }

  post<T>(
    path: string,
    data: unknown,
    options: DataProcessingRequestOptions = {},
  ): Observable<AxiosResponse<T>> {
    return defer(() => this.request<T>('POST', path, data, options));
  }

  private transition(state: typeof this.state): void {
    this.state = state;
    this.generation++;
    this.breaker.set(state === 'closed' ? 0 : state === 'open' ? 1 : 2);
    if (state === 'open') this.openedAt = Date.now();
  }

  private transient(error: unknown): boolean {
    return (
      error instanceof TimeoutError ||
      (isAxiosError(error) &&
        (!error.response ||
          error.response.status === 429 ||
          error.response.status >= 500))
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    data: unknown,
    options: DataProcessingRequestOptions,
  ): Promise<AxiosResponse<T>> {
    // Never allow absolute URLs to receive the service credential.
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      throw new Error('Expected a relative data-processing path');
    let probe = false;
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetMs) {
      this.transition('half_open');
      probe = true;
    } else if (this.state !== 'closed') {
      this.outcomes.inc({ method, outcome: 'circuit_open' });
      throw new DataProcessingUnavailableError('circuit_open');
    }
    const generation = this.generation;
    // Analysis is read-only despite using POST. Never automatically replay job submissions.
    const retries =
      options.retry === false ||
      probe ||
      (method === 'POST' && path !== '/analyze')
        ? 0
        : this.retries;
    const headers = {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: RequestContextService.getCorrelationId(),
      [REQUEST_ID_HEADER]: RequestContextService.getRequestId(),
      ...options.headers,
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
    };
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      try {
        const ms = options.timeout ?? this.timeoutMs;
        const response = await firstValueFrom(
          this.http
            .request<T>({
              method,
              url: `${this.baseUrl}${path}`,
              data,
              headers,
              timeout: ms,
              signal: controller.signal,
              maxRedirects: 0,
            })
            .pipe(timeout(ms)),
        );
        this.outcomes.inc({ method, outcome: 'success' });
        if (generation === this.generation) {
          this.failures = 0;
          if (probe) this.transition('closed');
        }
        return response;
      } catch (error: unknown) {
        controller.abort();
        const transient = this.transient(error);
        const timedOut =
          error instanceof TimeoutError ||
          (isAxiosError(error) &&
            ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? ''));
        this.outcomes.inc({ method, outcome: timedOut ? 'timeout' : 'error' });
        if (transient && attempt < retries) {
          this.outcomes.inc({ method, outcome: 'retry' });
          await new Promise<void>((resolve) =>
            setTimeout(resolve, 100 * 2 ** attempt),
          );
          continue;
        }
        if (generation === this.generation) {
          if (transient) {
            this.failures++;
            if (probe || this.failures >= this.failureThreshold)
              this.transition('open');
          } else {
            this.failures = 0;
            if (probe) this.transition('closed');
          }
        }
        if (transient)
          throw new DataProcessingUnavailableError(
            timedOut ? 'timeout' : 'unavailable',
          );
        throw error;
      } finally {
        controller.abort();
      }
    }
  }
}
