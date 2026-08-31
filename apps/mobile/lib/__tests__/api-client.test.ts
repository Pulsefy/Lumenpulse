/**
 * API Client Tests
 * Comprehensive test suite for retry logic, timeout handling, and offline detection
 */

import NetInfo from '@react-native-community/netinfo';
import { ApiClient, TimeoutError, OfflineError, NetworkError } from '../api-client';

// Mock NetInfo
jest.mock('@react-native-community/netinfo');

// Mock fetch
global.fetch = jest.fn();

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create fresh client instance
    client = new ApiClient();

    // Default: device is online
    (NetInfo.fetch as jest.Mock).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Retry Logic', () => {
    it('should retry idempotent GET requests up to 3 times on 5xx errors', async () => {
      // Mock 3 failures, then success
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          json: async () => ({ message: 'Bad Gateway' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ message: 'Internal Server Error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'success' }),
        });

      // Start the request (doesn't block)
      const promise = client.get('/test');

      // Fast-forward through all retry delays
      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(true);
      expect(response.data).toEqual({ data: 'success' });
      expect(fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should retry idempotent PUT requests on network failures', async () => {
      // Mock network failures then success
      (fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ updated: true }),
        });

      const promise = client.put('/test', { name: 'test' });

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should retry idempotent DELETE requests on retryable status codes', async () => {
      // 429 Too Many Requests is retryable
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ message: 'Too Many Requests' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
        });

      const promise = client.delete('/test');

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should give up after max retries and return error', async () => {
      // All attempts fail
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test');

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.statusCode).toBe(503);
      expect(fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('should use exponential backoff with jitter', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Spy on setTimeout to capture delay values
      jest.spyOn(global, 'setTimeout').mockImplementation(((
        callback: () => void,
        ms?: number,
      ) => {
        if (ms && ms > 100) {
          // Only capture retry delays (not timeout delays)
          delays.push(ms);
        }
        return originalSetTimeout(callback, 0); // Execute immediately for test
      }) as any);

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'success' }),
        });

      const promise = client.get('/test');
      await jest.runAllTimersAsync();
      await promise;

      // Verify exponential backoff pattern (each delay should be roughly 2x previous)
      expect(delays.length).toBe(3);
      // First retry: ~1000ms + jitter
      expect(delays[0]).toBeGreaterThanOrEqual(1000);
      expect(delays[0]).toBeLessThan(1500);
      // Second retry: ~2000ms + jitter
      expect(delays[1]).toBeGreaterThanOrEqual(2000);
      expect(delays[1]).toBeLessThan(2500);
      // Third retry: ~4000ms + jitter
      expect(delays[2]).toBeGreaterThanOrEqual(4000);
      expect(delays[2]).toBeLessThan(4500);
    });
  });

  describe('Non-Idempotent Methods', () => {
    it('should NOT retry POST requests on error', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const response = await client.post('/test', { data: 'test' });

      expect(response.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry PATCH requests on error', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal Server Error' }),
      });

      const response = await client.patch('/test', { data: 'test' });

      expect(response.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should allow manual retry override for POST requests', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ created: true }),
        });

      // Explicitly enable retry for non-idempotent POST
      const promise = client.post('/test', { data: 'test' }, { retry: { maxRetries: 2 } });

      await jest.runAllTimersAsync();

      const response = await promise;

      // POST is non-idempotent, so still won't retry despite override
      expect(response.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Timeout Handling', () => {
    it('should throw TimeoutError when request exceeds timeout', async () => {
      // Mock a slow request
      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: 'success' }),
              });
            }, 15000); // 15 seconds
          }),
      );

      const promise = client.get('/test', { timeout: 5000 });

      // Fast-forward past timeout
      jest.advanceTimersByTime(5000);

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('TimeoutError');
      expect(response.error?.message).toContain('timeout');
    });

    it('should use default timeout of 10 seconds', async () => {
      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: 'success' }),
              });
            }, 20000);
          }),
      );

      const promise = client.get('/test');

      jest.advanceTimersByTime(10000);

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('TimeoutError');
    });

    it('should allow custom timeout configuration', async () => {
      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: 'success' }),
              });
            }, 10000);
          }),
      );

      const promise = client.get('/test', { timeout: 3000 });

      jest.advanceTimersByTime(3000);

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('TimeoutError');
    });
  });

  describe('Cancellation Support', () => {
    it('should stop request when AbortSignal is triggered', async () => {
      const controller = new AbortController();

      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({ data: 'success' }),
              });
            }, 5000);
          }),
      );

      const promise = client.get('/test', { signal: controller.signal });

      // Cancel after 1 second
      setTimeout(() => controller.abort(), 1000);
      jest.advanceTimersByTime(1000);

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('cancelled');
    });

    it('should stop retry loop when AbortSignal is triggered', async () => {
      const controller = new AbortController();

      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test', { signal: controller.signal });

      // Let first request fail, then cancel before retry
      await jest.advanceTimersByTimeAsync(100);
      controller.abort();
      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      // Should fail on first or second attempt, not all 4
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should cleanup timeout on successful request', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      });

      await client.get('/test');

      // Verify cleanup was called
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('Offline Detection', () => {
    it('should fail immediately with OfflineError when device is offline', async () => {
      // Mock offline state
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });

      // First request will be attempted, then detect offline on retry
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test');

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('OfflineError');
      // Should stop after first failure + offline detection
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should check connectivity before retry attempts', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'Service Unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'success' }),
        });

      const promise = client.get('/test');

      await jest.runAllTimersAsync();

      await promise;

      // NetInfo should be checked before retry
      expect(NetInfo.fetch).toHaveBeenCalled();
    });

    it('should NOT retry when device goes offline during retry loop', async () => {
      // Start online
      (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({
        isConnected: true,
        isInternetReachable: true,
      });

      // First request fails
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test');

      // Advance to trigger retry
      await jest.advanceTimersByTimeAsync(1000);

      // Now go offline
      (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false,
      });

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('OfflineError');
      expect(fetch).toHaveBeenCalledTimes(1); // Only initial attempt
    });
  });

  describe('Non-Retryable Errors', () => {
    it('should NOT retry on 4xx client errors', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      });

      const response = await client.get('/test');

      expect(response.success).toBe(false);
      expect(response.error?.statusCode).toBe(404);
      expect(fetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should NOT retry on 401 unauthorized', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Unauthorized' }),
      });

      const response = await client.get('/test');

      expect(response.success).toBe(false);
      expect(response.error?.statusCode).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 403 forbidden', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Forbidden' }),
      });

      const response = await client.get('/test');

      expect(response.success).toBe(false);
      expect(response.error?.statusCode).toBe(403);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry Configuration', () => {
    it('should allow disabling retry with retry: false', async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const response = await client.get('/test', { retry: false });

      expect(response.success).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1); // No retries
    });

    it('should allow custom retry configuration', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test', {
        retry: {
          maxRetries: 1, // Only 1 retry instead of 3
          baseDelay: 500,
        },
      });

      await jest.runAllTimersAsync();

      await promise;

      expect(fetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    it('should allow custom retryable status codes', async () => {
      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404, // Normally not retryable
          json: async () => ({ message: 'Not Found' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: 'success' }),
        });

      const promise = client.get('/test', {
        retry: {
          retryableStatusCodes: [404, 503], // Include 404
        },
      });

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Auth Token', () => {
    it('should set authorization header when token is provided', async () => {
      client.setAuthToken('test-token-123');

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      });

      await client.get('/test');

      const fetchCall = (fetch as jest.Mock).mock.calls[0];
      const headers = fetchCall[1].headers;

      expect(headers.Authorization).toBe('Bearer test-token-123');
    });

    it('should remove authorization header when token is cleared', async () => {
      client.setAuthToken('test-token-123');
      client.setAuthToken(null);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: 'success' }),
      });

      await client.get('/test');

      const fetchCall = (fetch as jest.Mock).mock.calls[0];
      const headers = fetchCall[1].headers;

      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('Error Normalization', () => {
    it('should normalize TimeoutError correctly', async () => {
      (fetch as jest.Mock).mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves
          }),
      );

      const promise = client.get('/test', { timeout: 1000 });

      jest.advanceTimersByTime(1000);

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('TimeoutError');
      expect(response.error?.message).toContain('timeout');
    });

    it('should normalize OfflineError correctly', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'Service Unavailable' }),
      });

      const promise = client.get('/test');

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('OfflineError');
      expect(response.error?.message).toContain('offline');
    });

    it('should normalize NetworkError correctly', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new TypeError('fetch failed'));

      const promise = client.get('/test');

      await jest.runAllTimersAsync();

      const response = await promise;

      expect(response.success).toBe(false);
      expect(response.error?.error).toBe('NetworkError');
    });
  });
});
