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
  rawMessage?: string;
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
  retries?: number;
  retryDelay?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /network request failed|failed to fetch|network error/i.test(error.message);
}

function isTimeoutFailure(error: ApiError): boolean {
  return error.error === 'TimeoutError' || /timeout/i.test(error.message);
}

function shouldRetryRequest(error: ApiError, method: string | undefined): boolean {
  const retryableStatuses = [429, 502, 503, 504];

  if (isTimeoutFailure(error) || error.error === 'NetworkError') {
    return true;
  }

  if (error.statusCode && retryableStatuses.includes(error.statusCode)) {
    return true;
  }

  if (error.statusCode && error.statusCode >= 500) {
    return true;
  }

  return false;
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

  private getFriendlyErrorMessage(rawMessage: string, errorType?: string, statusCode?: number): string {
    const normalized = rawMessage?.trim() || '';

    if (statusCode === 401) {
      return 'Authentication failed. Please sign in again.';
    }
    if (statusCode === 403) {
      return 'You do not have permission to perform this action.';
    }
    if (statusCode === 404) {
      return 'The requested resource could not be found.';
    }
    if (statusCode === 429) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (statusCode && statusCode >= 500) {
      return 'The service is temporarily unavailable. Please try again shortly.';
    }
    if (errorType === 'TimeoutError' || /timeout/i.test(normalized)) {
      return 'The request timed out. Please try again.';
    }
    if (errorType === 'AbortError') {
      return 'The request was cancelled. Please try again.';
    }
    if (/network request failed|failed to fetch|network error/i.test(normalized)) {
      return 'Network error. Please check your internet connection and try again.';
    }

    return normalized || 'Something went wrong. Please try again.';
  }

  /**
   * Normalize errors into a consistent shape
   */
  private normalizeError(error: unknown, statusCode?: number): ApiError {
    let message = 'An unknown error occurred';
    let errorType = 'UnknownError';
    let details: unknown;

    if (error instanceof Error) {
      message = error.message;
      errorType = error.name;
    } else if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      message = (typeof err.message === 'string' && err.message.length > 0)
        ? err.message
        : message;
      errorType = (typeof err.error === 'string' && err.error.length > 0)
        ? err.error
        : errorType;
      details = err.details ?? err;
    }

    const friendlyMessage = this.getFriendlyErrorMessage(message, errorType, statusCode);

    return {
      message: friendlyMessage,
      statusCode,
      error: errorType,
      details,
      rawMessage: friendlyMessage !== message ? message : undefined,
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
    const maxAttempts = Math.max(1, config.retries ?? 3);
    const backoffMs = config.retryDelay ?? 400;
    const method = (options.method ?? 'GET').toString().toUpperCase();

    let attempt = 0;
    let lastError: ApiError | null = null;

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout || this.defaultTimeout);

      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: config.signal || controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({
            message: `HTTP ${response.status}: ${response.statusText}`,
          }));
          const apiError = this.normalizeError(errorData, response.status);

          if (attempt < maxAttempts && shouldRetryRequest(apiError, method)) {
            lastError = apiError;
            await sleep(backoffMs * 2 ** (attempt - 1) + Math.round(Math.random() * 100));
            continue;
          }

          return {
            success: false,
            error: apiError,
          };
        }

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
        clearTimeout(timeoutId);

        let apiError = this.normalizeError(error);
        if (isNetworkFailure(error)) {
          apiError = {
            ...apiError,
            message: this.getFriendlyErrorMessage(apiError.message, apiError.error, apiError.statusCode),
            error: 'NetworkError',
          };
        }

        lastError = apiError;

        if (attempt < maxAttempts && shouldRetryRequest(apiError, method)) {
          await sleep(backoffMs * 2 ** (attempt - 1) + Math.round(Math.random() * 100));
          continue;
        }

        return {
          success: false,
          error: apiError,
        };
      }
    }

    return {
      success: false,
      error: lastError ?? {
        message: 'Something went wrong. Please try again.',
        error: 'UnknownError',
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
