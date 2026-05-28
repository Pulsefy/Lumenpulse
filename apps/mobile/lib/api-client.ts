import { config as appConfig, getEnvironmentConfig } from './config';

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
}

/**
 * Reusable API Client
 * Provides typed HTTP methods with consistent error handling
 */
class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;

  constructor() {
    this.baseUrl = getApiBaseUrl();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.defaultTimeout = appConfig.api.timeout;
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
   * Make HTTP request with error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    this.baseUrl = getApiBaseUrl();
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.defaultHeaders, ...config.headers };

    const maxRetries = (appConfig.api.maxRetries as number) ?? 3;
    const baseMs = (appConfig.api.backoffBaseMs as number) ?? 300;
    const multiplier = (appConfig.api.backoffMultiplier as number) ?? 2;
    const jitter = (appConfig.api.backoffJitter as boolean) ?? true;

    const method = (options.method || 'GET').toUpperCase();

    // Helper to perform a single fetch attempt with timeout
    const singleAttempt = async (): Promise<{ response?: Response; error?: unknown }>
 => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout || this.defaultTimeout);

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: config.signal || controller.signal,
        });

        clearTimeout(timeoutId);
        return { response };
      } catch (err) {
        clearTimeout(timeoutId);
        return { error: err };
      }
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // If caller aborted, stop retrying
      if (config.signal && config.signal.aborted) {
        return {
          success: false,
          error: {
            message: 'Request aborted',
            error: 'AbortError',
          },
        };
      }

      const { response, error } = await singleAttempt();

      // If we have a response
      if (response) {
        if (!response.ok) {
          // Parse error body if available
          const errorData = await response.json().catch(() => ({
            message: `HTTP ${response.status}: ${response.statusText}`,
          }));

          // Retry on 5xx or 429 for idempotent methods
          const status = response.status;
          const shouldRetry = (status >= 500 || status === 429) && method !== 'POST';

          if (shouldRetry && attempt < maxRetries) {
            const backoff = Math.pow(multiplier, attempt) * baseMs;
            const delay = jitter ? Math.round(backoff * (0.5 + Math.random() * 0.5)) : backoff;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          return {
            success: false,
            error: this.normalizeError(errorData, status),
          };
        }

        // 204 No Content
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
      }

      // If there was a fetch error (network, timeout, DNS, etc.)
      if (error) {
        // Timeout / Abort
        if (error instanceof Error && error.name === 'AbortError') {
          // Do not retry on explicit abort
          return {
            success: false,
            error: {
              message: 'Request timeout',
              error: 'TimeoutError',
            },
          };
        }

        // For network errors, retry for idempotent methods
        const shouldRetryNetwork = method !== 'POST' && attempt < maxRetries;
        if (shouldRetryNetwork) {
          const backoff = Math.pow(multiplier, attempt) * baseMs;
          const delay = jitter ? Math.round(backoff * (0.5 + Math.random() * 0.5)) : backoff;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        return {
          success: false,
          error: this.normalizeError(error),
        };
      }
    }

    return {
      success: false,
      error: {
        message: 'Request failed after retries',
        error: 'RetryError',
      },
    };
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
}

// Export singleton instance
export const apiClient = new ApiClient();

// Export class for testing or multiple instances
export { ApiClient };
