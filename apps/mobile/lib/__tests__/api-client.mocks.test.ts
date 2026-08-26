import { ApiClient } from '../api-client';

describe('ApiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reads the configured base URL and sets auth tokens', () => {
    const client = new ApiClient();

    expect(typeof client.getBaseUrl()).toBe('string');
    client.setAuthToken('abc');
    expect(client.getBaseUrl().length).toBeGreaterThan(0);
  });

  it('returns normalized error data for non-OK responses', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: jest.fn().mockResolvedValue({ message: 'Invalid payload', error: 'BadRequest' }),
    });

    const result = await client.post('/profile', { hello: 'world' });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Invalid payload');
    expect(result.error?.statusCode).toBe(400);
  });

  it('returns timeout errors when the request is aborted', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockImplementation(() => {
      const error = new Error('Request timed out');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const result = await client.get('/slow', { timeout: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Request timeout');
  });

  it('returns successful JSON payloads', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ ok: true }),
    });

    const result = await client.get<{ ok: boolean }>('/health');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });
});
