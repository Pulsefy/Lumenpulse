import NetInfo from '@react-native-community/netinfo';
import { config, getEnvironmentConfig } from './config';

/**
 * API Client Configuration
 * Reads from centralized config
 */
const getApiBaseUrl = (): string => {
  return getEnvironmentConfig().apiBaseUrl;
};

/**
 * Common API Error Shape
 */
export interface ApiError {
  message: string;
  statusCode?: number;
  error?: string;
  details?: unknown;
}

/**
 * API Response wrapper for consistent handling
 */
export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

/**
 * Request configuration options
 */
export interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  /**
   * Maximum number of retries for idempotent requests.
   * Overrides the shared retry policy. Defaults to 2.
   */
  retries?: number;
  /**
   * Base backoff delay in milliseconds (before jitter). Defaults to 500.
   */
  baseDelay?: number;
  /**
   * Upper bound for a single backoff delay in milliseconds. Defaults to 8000.
   */
  maxDelay?: number;
}

/**
 * Shared retry policy for idempotent requests.
 */
interface RetryPolicy {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  factor: number;
  jitter: boolean;
}

/**
 * Reusable API Client
 * Provides typed HTTP methods with consistent error handling
 */
class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private retryPolicy: RetryPolicy = {
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 8000,
    factor: 2,
    jitter: true,
  };

  constructor() {
    this.baseUrl = getApiBaseUrl();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.defaultTimeout = config.api.timeout;
  }

  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Set authorization token for authenticated requests
   */
  setAuthToken(token: string | null): void {
    if (token) {
      this.defaultHeaders['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.defaultHeaders['Authorization'];
    }
  }

  /**
   * Normalize errors into a consistent shape
   */
  private normalizeError(error: unknown, statusCode?: number): ApiError {
    if (error instanceof Error) {
      return {
        message: error.message,
        statusCode,
        error: error.name,
      };
    }

    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      return {
        message: (err.message as string) || 'An unknown error occurred',
        statusCode: statusCode || (err.statusCode as number),
        error: (err.error as string) || 'UnknownError',
        details: err.details,
      };
    }

    return {
      message: 'An unknown error occurred',
      statusCode,
      error: 'UnknownError',
    };
  }

  /**
   * Distinct, user-visible timeout error.
   */
  private timeoutError(): ApiError {
    return { message: 'Request timeout', error: 'TimeoutError' };
  }

  /**
   * Request was cancelled (e.g. the screen unmounted).
   */
  private cancelledError(): ApiError {
    return { message: 'Request cancelled', error: 'CancelledError' };
  }

  /**
   * Device is offline / the network is unreachable.
   */
  private offlineError(): ApiError {
    return { message: 'No internet connection', error: 'NetworkError' };
  }

  /**
   * Transient network failure.
   */
  private networkError(): ApiError {
    return { message: 'Network request failed', error: 'NetworkError' };
  }

  /**
   * Whether the HTTP method is safe to retry (idempotent).
   */
  private isIdempotentMethod(method: string): boolean {
    return method === 'GET' || method === 'HEAD';
  }

  /**
   * Whether a failed response warrants a retry.
   * Network errors, timeouts and server errors (5xx / 408 / 429) are retriable.
   */
  private isRetriableError(error?: ApiError): boolean {
    if (!error) return true;
    const status = error.statusCode;
    if (status === undefined) return true;
    if (status === 408 || status === 425 || status === 429) return true;
    return status >= 500;
  }

  /**
   * Exponential backoff with (half-to-full) jitter so parallel screens
   * don't line up into a request storm.
   */
  private computeBackoffDelay(attempt: number, base: number, max: number): number {
    const { factor, jitter } = this.retryPolicy;
    const backoff = Math.min(max, base * Math.pow(factor, attempt));
    if (!jitter) return backoff;
    return Math.round(backoff * (0.5 + Math.random() * 0.5));
  }

  /**
   * Sleep for the given delay, resolving early if the request is cancelled.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();

      const onAbort = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Current connectivity state.
   */
  private async isOnline(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected ?? true;
    } catch {
      return true;
    }
  }

  /**
   * Wait for connectivity to return. Resolves `false` when the request is
   * cancelled so the caller can bail out without spinning while offline.
   */
  private waitForConnectivity(signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve(false);

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        if (typeof unsubscribe === 'function') unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };

      const unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected) {
          cleanup();
          resolve(true);
        }
      });

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Perform a single HTTP attempt with a per-attempt timeout and support for
   * external cancellation.
   */
  private async attempt<T>(
    url: string,
    options: RequestInit,
    headers: Record<string, string>,
    config: RequestConfig,
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    let timedOut = false;

    const onAbort = () => controller.abort();
    if (config.signal) {
      config.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Per-attempt timeout. A fresh AbortController is used each attempt so a
    // timeout on one try doesn't poison the retry.
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeout ?? this.defaultTimeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (config.signal) config.signal.removeEventListener('abort', onAbort);
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      // Handle non-OK responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          message: `HTTP ${response.status}: ${response.statusText}`,
        }));

        return {
          success: false,
          error: this.normalizeError(errorData, response.status),
        };
      }

      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return {
          success: true,
          data: undefined as T,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      // Handle abort: timeout fires internally, or an external (screen
      // unmount) signal aborted the request.
      if (error instanceof Error && error.name === 'AbortError') {
        if (config.signal?.aborted && !timedOut) {
          return { success: false, error: this.cancelledError() };
        }
        return { success: false, error: this.timeoutError() };
      }

      // Handle network errors
      return {
        success: false,
        error: this.networkError(),
      };
    } finally {
      cleanup();
    }
  }

  /**
   * Make HTTP request with shared retry/backoff, connectivity gating and
   * cancellation support.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    this.baseUrl = getApiBaseUrl();
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.defaultHeaders, ...config.headers };
    const method = (options.method || 'GET').toUpperCase();

    // Cancelled before the request began
    if (config.signal?.aborted) {
      return { success: false, error: this.cancelledError() };
    }

    // Do not hammer the API while the device is offline
    if (!(await this.isOnline())) {
      return { success: false, error: this.offlineError() };
    }

    const idempotent = this.isIdempotentMethod(method);
    const maxRetries = config.retries ?? (idempotent ? this.retryPolicy.maxRetries : 0);
    const baseDelay = config.baseDelay ?? this.retryPolicy.baseDelay;
    const maxDelay = config.maxDelay ?? this.retryPolicy.maxDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.attempt<T>(url, options, headers, config);
      if (result.success) return result;

      if (config.signal?.aborted) {
        return { success: false, error: this.cancelledError() };
      }

      if (attempt >= maxRetries) return result;
      if (!idempotent || !this.isRetriableError(result.error)) return result;

      // Gate retries on connectivity: wait for the network to return instead
      // of spinning through backoff delays while offline.
      if (!(await this.isOnline())) {
        const reconnected = await this.waitForConnectivity(config.signal);
        if (!reconnected) {
          return config.signal?.aborted
            ? { success: false, error: this.cancelledError() }
            : { success: false, error: this.offlineError() };
        }
      }

      await this.sleep(this.computeBackoffDelay(attempt, baseDelay, maxDelay), config.signal);
      if (config.signal?.aborted) {
        return { success: false, error: this.cancelledError() };
      }
    }

    return { success: false, error: this.networkError() };
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' }, config);
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      config,
    );
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: unknown, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      },
      config,
    );
  }

  /**
   * PATCH request
   */
  async patch<T>(
    endpoint: string,
    body?: unknown,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(
      endpoint,
      {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      },
      config,
    );
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' }, config);
  }

  /**
   * DELETE request with a JSON body.
   */
  async deleteWithBody<T>(
    endpoint: string,
    body: unknown,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', body: JSON.stringify(body) }, config);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or multiple instances
export { ApiClient };
