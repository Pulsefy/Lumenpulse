import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Counter, Gauge } from 'prom-client';
import { firstValueFrom } from 'rxjs';
import { MetricsService } from '../metrics/metrics.service';

export type DataProcessingErrorCode =
  | 'CIRCUIT_OPEN'
  | 'TIMEOUT'
  | 'REQUEST_FAILED';

export class DataProcessingClientError extends HttpException {
  constructor(
    public readonly code: DataProcessingErrorCode,
    message: string,
    statusCode: number = HttpStatus.SERVICE_UNAVAILABLE,
    public readonly cause?: unknown,
    public readonly responseData?: unknown,
  ) {
    super({ statusCode, message, code }, statusCode);
    this.name = 'DataProcessingClientError';
  }
}

export class DataProcessingCircuitOpenError extends DataProcessingClientError {
  constructor() {
    super(
      'CIRCUIT_OPEN',
      'Data-processing service circuit is open',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    this.name = 'DataProcessingCircuitOpenError';
  }
}

export interface DataProcessingRequestOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

type CircuitState = 'closed' | 'open' | 'half_open';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 100;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

@Injectable()
export class DataProcessingClientService {
  private readonly logger = new Logger(DataProcessingClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestCounter: Counter<string>;
  private readonly breakerGauge: Gauge<string>;
  private circuitState: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenProbeActive = false;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
    metricsService: MetricsService,
  ) {
    this.baseUrl = (
      configService.get<string>('DATA_PROCESSING_URL') ||
      configService.get<string>('PYTHON_SERVICE_URL') ||
      configService.get<string>('PYTHON_API_URL') ||
      'http://localhost:8000'
    ).replace(/\/$/, '');
    this.apiKey =
      configService.get<string>('DATA_PROCESSING_API_KEY') ||
      configService.get<string>('PYTHON_API_KEY') ||
      '';

    this.requestCounter = metricsService.getOrCreateCounter(
      'data_processing_requests_total',
      'Data-processing service requests by method and outcome',
      ['method', 'outcome'],
    );
    this.breakerGauge = metricsService.getOrCreateGauge(
      'data_processing_circuit_breaker_state',
      'Current data-processing circuit-breaker state',
      ['state'],
    );
    this.recordCircuitState();
  }

  get<T>(path: string, options: DataProcessingRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(
    path: string,
    body: unknown,
    options: DataProcessingRequestOptions = {},
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: DataProcessingRequestOptions,
  ): Promise<T> {
    if (!this.acquireCircuitPermit()) {
      this.requestCounter.labels(method, 'circuit_open').inc();
      throw new DataProcessingCircuitOpenError();
    }

    const config: AxiosRequestConfig = {
      url: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
      method,
      data: body,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
        ...options.headers,
      },
    };
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    for (let attempt = 0; ; attempt++) {
      try {
        const response: AxiosResponse<T> = await firstValueFrom(
          this.httpService.request<T>(config),
        );
        this.recordSuccess();
        this.requestCounter.labels(method, 'success').inc();
        return response.data;
      } catch (error: unknown) {
        if (attempt < maxRetries && this.isRetryable(error)) {
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
          continue;
        }

        if (this.shouldCountAsCircuitFailure(error)) {
          this.recordFailure();
        } else {
          this.recordSuccess();
        }
        this.requestCounter.labels(method, 'error').inc();
        throw this.toClientError(error);
      }
    }
  }

  private acquireCircuitPermit(): boolean {
    if (this.circuitState === 'closed') return true;

    if (
      this.circuitState === 'open' &&
      Date.now() - this.openedAt >= CIRCUIT_RESET_TIMEOUT_MS
    ) {
      this.circuitState = 'half_open';
      this.halfOpenProbeActive = false;
      this.recordCircuitState();
    }

    if (this.circuitState === 'half_open' && !this.halfOpenProbeActive) {
      this.halfOpenProbeActive = true;
      return true;
    }
    return false;
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.halfOpenProbeActive = false;
    if (this.circuitState !== 'closed') {
      this.circuitState = 'closed';
      this.recordCircuitState();
    }
  }

  private recordFailure(): void {
    this.halfOpenProbeActive = false;
    this.consecutiveFailures++;
    if (
      this.circuitState === 'half_open' ||
      this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    ) {
      this.circuitState = 'open';
      this.openedAt = Date.now();
      this.recordCircuitState();
    }
  }

  private shouldCountAsCircuitFailure(error: unknown): boolean {
    const status = (error as AxiosError).response?.status;
    return status === undefined || status === 429 || status >= 500;
  }

  private recordCircuitState(): void {
    for (const state of ['closed', 'open', 'half_open'] as const) {
      this.breakerGauge.labels(state).set(this.circuitState === state ? 1 : 0);
    }
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof AxiosError) && !this.isAxiosError(error)) return false;
    const status = (error as AxiosError).response?.status;
    return status === undefined || status === 429 || status >= 500;
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'isAxiosError' in error &&
      (error as { isAxiosError?: unknown }).isAxiosError === true
    );
  }

  private toClientError(error: unknown): DataProcessingClientError {
    if (error instanceof DataProcessingClientError) return error;

    const axiosError = error as AxiosError<{ detail?: string }>;
    const statusCode = axiosError.response?.status;
    const code: DataProcessingErrorCode =
      axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT'
        ? 'TIMEOUT'
        : 'REQUEST_FAILED';
    const message =
      axiosError.response?.data?.detail ||
      axiosError.message ||
      'Data-processing service request failed';

    this.logger.warn(`${code}: ${message}`);
    return new DataProcessingClientError(
      code,
      message,
      statusCode ?? HttpStatus.SERVICE_UNAVAILABLE,
      error,
      axiosError.response?.data,
    );
  }
}