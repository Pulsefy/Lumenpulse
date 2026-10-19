import { checkConnection } from '../check-connection';

describe('checkConnection', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each([200, 404, 500])('treats HTTP %s as reachable without parsing a body', async (status) => {
    mockFetch.mockResolvedValue({ status, ok: status < 400 });

    await expect(checkConnection('https://example.com')).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith('https://example.com', {
      signal: expect.any(AbortSignal),
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates network errors and clears the timeout', async () => {
    const error = new TypeError('Network request failed');
    mockFetch.mockRejectedValue(error);

    await expect(checkConnection('https://example.com')).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a stalled request after five seconds', async () => {
    mockFetch.mockImplementation(
      (_url: string, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Request aborted')));
        }),
    );
    const result = checkConnection('https://example.com');
    const assertion = expect(result).rejects.toThrow('Request aborted');
    const signal = mockFetch.mock.calls[0][1].signal as AbortSignal;

    await jest.advanceTimersByTimeAsync(4999);
    expect(signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await assertion;
    expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
