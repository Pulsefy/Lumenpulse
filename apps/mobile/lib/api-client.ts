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
 * Custom Error Classes for Network Issues
 */
export class TimeoutError extends Error {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

export class OfflineError extends Error {
  constructor(message: string = 'Device is offline') {
    super(message);
    this.name = 'OfflineError';
    Object.setPrototypeOf(this, OfflineError.prototype);
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

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
 * Retry configuration options
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: number;
  retryableStatusCodes?: number[];
}

/**
 * Request configuration options
 */
export interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  retry?: boolean | RetryConfig;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  jitter: 500, // 0-500ms random jitter
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * HTTP methods that are safe to retry (idempotent)
 */
const IDEMPOTENT_METHODS = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * Reusable API Client
 * Provides typed HTTP methods with consistent error handling, retry logic, and offline detection
 */
class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private retryConfig: Required<RetryConfig>;

  constructor() {
    this.baseUrl = getApiBaseUrl();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.defaultTimeout = 10000; // Stricter 10 second timeout for mobile
    this.retryConfig = DEFAULT_RETRY_CONFIG;
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
   * Check if device is online
   */
  private async isOnline(): Promise<boolean> {
    try {
      const state = await NetInfo.fetch();
      return state.isConnected === true && state.isInternetReachable !== false;
    } catch (error) {
      // If we can't determine network state, assume we're online
      // and let the actual request fail with a proper error
      return true;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoff(attempt: number, config: Required<RetryConfig>): number {
    const exponentialDelay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
    const jitter = Math.random() * config.jitter;
    return exponentialDelay + jitter;
  }

  /**
   * Check if an HTTP method is idempotent and safe to retry
   */
  private isIdempotent(method: string): boolean {
    return IDEMPOTENT_METHODS.includes(method.toUpperCase());
  }

  /**
   * Check if a status code is retryable
   */
  private isRetryableStatus(statusCode: number, retryableStatusCodes: number[]): boolean {
    return retryableStatusCodes.includes(statusCode);
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown, statusCode?: number): boolean {
    // Network errors (no response received)
    if (error instanceof Error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return true; // Network failure
      }
      if (error.name === 'NetworkError') {
        return true;
      }
    }

    // Retryable HTTP status codes
    if (statusCode && this.isRetryableStatus(statusCode, this.retryConfig.retryableStatusCodes)) {
      return true;
    }

    return false;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Normalize errors into a consistent shape
   */
  private normalizeError(error: unknown, statusCode?: number): ApiError {
    if (error instanceof TimeoutError) {
      return {
        message: error.message,
        statusCode,
        error: 'TimeoutError',
      };
    }

    if (error instanceof OfflineError) {
      return {
        message: error.message,
        statusCode,
        error: 'OfflineError',
      };
    }

    if (error instanceof NetworkError) {
      return {
        message: error.message,
        statusCode,
        error: 'NetworkError',
      };
    }

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
   * Create an AbortController with timeout support
   */
  private createTimeoutController(
    timeoutMs: number,
    userSignal?: AbortSignal,
  ): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    // If user provided a signal, link it to our controller
    if (userSignal) {
      if (userSignal.aborted) {
        controller.abort();
      } else {
        const abortHandler = () => controller.abort();
        userSignal.addEventListener('abort', abortHandler);
        
        const cleanup = () => {
          userSignal.removeEventListener('abort', abortHandler);
          if (timeoutId) clearTimeout(timeoutId);
        };

        // Set timeout
        timeoutId = setTimeout(() => {
          controller.abort();
        }, timeoutMs);

        return { controller, cleanup };
      }
    }

    // No user signal, just set timeout
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };

    return { controller, cleanup };
  }

  /**
   * Execute a single HTTP request (without retry logic)
   */
  private async executeRequest<T>(
    url: string,
    options: RequestInit,
    timeoutMs: number,
    userSignal?: AbortSignal,
  ): Promise<ApiResponse<T>> {
    const { controller, cleanup } = this.createTimeoutController(timeoutMs, userSignal);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      cleanup();

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
      cleanup();

      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        // Check if it was user-initiated cancellation or timeout
        if (userSignal?.aborted) {
          throw new Error('Request cancelled');
        }
        throw new TimeoutError(`Request timeout after ${timeoutMs}ms`);
      }

      // Handle network errors
      if (error instanceof Error && error.message.includes('fetch')) {
        throw new NetworkError('Network request failed');
      }

      throw error;
    }
  }

  /**
   * Make HTTP request with retry logic and error handling
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
    const timeoutMs = config.timeout || this.defaultTimeout;

    // Determine retry configuration
    const shouldRetry = config.retry !== false;
    const retryConfig =
      typeof config.retry === 'object'
        ? { ...this.retryConfig, ...config.retry }
        : this.retryConfig;

    // Check if method is idempotent (safe to retry)
    const isIdempotent = this.isIdempotent(method);
    const canRetry = shouldRetry && isIdempotent;

    let lastError: unknown;
    let lastStatusCode: number | undefined;
    const maxAttempts = canRetry ? retryConfig.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check connectivity before attempting (except on first try)
        if (attempt > 0) {
          const online = await this.isOnline();
          if (!online) {
            throw new OfflineError('Device is offline, stopping retry attempts');
          }
        }

        // Check if request was cancelled before attempting
        if (config.signal?.aborted) {
          throw new Error('Request cancelled');
        }

        // Execute the request
        const response = await this.executeRequest<T>(
          url,
          { ...options, headers },
          timeoutMs,
          config.signal,
        );

        // If successful, return immediately
        if (response.success) {
          return response;
        }

        // Store error info for potential retry
        lastStatusCode = response.error?.statusCode;
        lastError = response.error;

        // Check if we should retry based on status code
        if (canRetry && attempt < maxAttempts - 1) {
          const isRetryable =
            lastStatusCode && this.isRetryableStatus(lastStatusCode, retryConfig.retryableStatusCodes);

          if (isRetryable) {
            const backoffDelay = this.calculateBackoff(attempt, retryConfig);
            await this.sleep(backoffDelay);
            continue; // Retry
          }
        }

        // Not retryable or last attempt, return error
        return response;
      } catch (error) {
        lastError = error;

        // Handle specific error types that should not be retried
        if (error instanceof TimeoutError) {
          // Timeout errors can be retried if we have attempts left
          if (!canRetry || attempt >= maxAttempts - 1) {
            return {
              success: false,
              error: this.normalizeError(error),
            };
          }
        } else if (error instanceof OfflineError) {
          // Offline errors should not be retried
          return {
            success: false,
            error: this.normalizeError(error),
          };
        } else if (error instanceof Error && error.message === 'Request cancelled') {
          // Cancelled requests should not be retried
          return {
            success: false,
            error: this.normalizeError(error),
          };
        } else if (error instanceof NetworkError) {
          // Network errors can be retried if we have attempts left
          if (!canRetry || attempt >= maxAttempts - 1) {
            return {
              success: false,
              error: this.normalizeError(error),
            };
          }
        } else {
          // Unknown errors, return immediately
          return {
            success: false,
            error: this.normalizeError(error),
          };
        }

        // If we get here, it's a retryable error
        if (attempt < maxAttempts - 1) {
          const backoffDelay = this.calculateBackoff(attempt, retryConfig);
          await this.sleep(backoffDelay);
        }
      }
    }

    // All attempts exhausted, return final error
    return {
      success: false,
      error: this.normalizeError(lastError, lastStatusCode),
    };
  }

  /**
   * GET request (idempotent, retried by default)
   */
  async get<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' }, config);
  }

  /**
   * POST request (not retried by default as it's non-idempotent)
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
   * PUT request (idempotent, retried by default)
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
   * PATCH request (not retried by default as it's non-idempotent)
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
   * DELETE request (idempotent, retried by default)
   */
  async delete<T>(endpoint: string, config?: RequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' }, config);
  }
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or multiple instances
export { ApiClient };
