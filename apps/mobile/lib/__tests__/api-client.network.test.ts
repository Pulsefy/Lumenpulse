import NetInfo from '@react-native-community/netinfo';
import { ApiClient } from '../api-client';

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn().mockReturnValue(jest.fn()),
}));

const abortError = (message: string) => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ApiClient network-aware retry behaviour', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(jest.fn());
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('retries idempotent GET requests on transient network errors', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

    const result = await client.get<{ ok: boolean }>('/health', {
      retries: 2,
      baseDelay: 2,
      maxDelay: 2,
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('retries on retriable server errors (5xx) for idempotent requests', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: jest.fn().mockResolvedValue({ message: 'boom' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

    const result = await client.get<{ ok: boolean }>('/health', {
      retries: 2,
      baseDelay: 2,
      maxDelay: 2,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('gives up after retries are exhausted and returns the final error', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const result = await client.get('/flaky', { retries: 3, baseDelay: 2, maxDelay: 2 });

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('NetworkError');
  });

  it('does not retry non-idempotent POST requests', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const result = await client.post('/submit', { value: 1 }, { retries: 3 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('NetworkError');
  });

  it('does not retry 4xx client errors on idempotent requests', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: jest.fn().mockResolvedValue({ message: 'Invalid payload', error: 'BadRequest' }),
    });

    const result = await client.get('/secure', { retries: 3 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.error?.error).toBe('BadRequest');
    expect(result.error?.statusCode).toBe(400);
  });

  it('cancels an in-flight request when the external signal aborts', async () => {
    const client = new ApiClient();
    const controller = new AbortController();
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(abortError('Aborted')));
        }),
    );

    const request = client.get('/slow', { signal: controller.signal });
    await flush();
    controller.abort();

    const result = await request;

    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('CancelledError');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels the retry backoff when the screen unmounts', async () => {
    const client = new ApiClient();
    const controller = new AbortController();
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const request = client.get('/flaky', {
      retries: 5,
      baseDelay: 1000,
      signal: controller.signal,
    });
    await flush();
    controller.abort();

    const result = await request;

    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('CancelledError');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns an immediate offline error without hitting the network', async () => {
    const client = new ApiClient();
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });

    const result = await client.get('/offline');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('NetworkError');
    expect(result.error?.message).toBe('No internet connection');
  });

  it('gates retries while offline instead of spinning', async () => {
    const client = new ApiClient();
    const controller = new AbortController();
    (NetInfo.fetch as jest.Mock)
      .mockResolvedValueOnce({ isConnected: true })
      .mockResolvedValue({ isConnected: false });
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const request = client.get('/flaky', {
      retries: 3,
      baseDelay: 2,
      maxDelay: 2,
      signal: controller.signal,
    });
    await flush();
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(global.fetch).toHaveBeenCalledTimes(1);

    controller.abort();
    const result = await request;
    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('CancelledError');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('resumes retrying after connectivity returns', async () => {
    const client = new ApiClient();
    let onlineReporters: ((state: { isConnected: boolean }) => void)[] = [];
    let online = false;
    (NetInfo.fetch as jest.Mock)
      .mockResolvedValueOnce({ isConnected: true })
      .mockImplementation(() => Promise.resolve({ isConnected: online }));
    (NetInfo.addEventListener as jest.Mock).mockImplementation((listener) => {
      onlineReporters.push(listener);
      return jest.fn();
    });
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

    const resultPromise = client.get<{ ok: boolean }>('/health', {
      retries: 3,
      baseDelay: 2,
      maxDelay: 2,
    });
    await flush();
    online = true;
    onlineReporters.forEach((listener) => listener({ isConnected: true }));

    const result = await resultPromise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });

  it('enforces a distinct timeout state even when an external signal is present', async () => {
    const client = new ApiClient();
    const controller = new AbortController();
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(abortError('timed out')));
        }),
    );

    const result = await client.get('/slow', { timeout: 5, signal: controller.signal });

    expect(result.success).toBe(false);
    expect(result.error?.error).toBe('TimeoutError');
    expect(result.error?.message).toBe('Request timeout');
  });

  it('retries a timed out idempotent request and recovers', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(abortError('Request timed out'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ ok: true }),
      });

    const result = await client.get<{ ok: boolean }>('/health', {
      retries: 2,
      baseDelay: 2,
      maxDelay: 2,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });
});
