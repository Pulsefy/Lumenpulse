import { ApiClient } from '../api-client';

describe('ApiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('uses a non-empty base URL and allows token updates', () => {
    const client = new ApiClient();

    expect(typeof client.getBaseUrl()).toBe('string');
    expect(client.getBaseUrl().length).toBeGreaterThan(0);

    client.setAuthToken('abc');
    expect(client.getBaseUrl()).toContain('http');
  });

  it('supports the standard HTTP methods', () => {
    const client = new ApiClient();

    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.patch).toBe('function');
    expect(typeof client.delete).toBe('function');
  });

  it('normalizes unsuccessful responses into a consistent error shape', async () => {
    const client = new ApiClient();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: jest.fn().mockResolvedValue({ message: 'Token expired', error: 'Unauthorized' }),
    });

    const result = await client.get('/secure');

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Token expired');
    expect(result.error?.statusCode).toBe(401);
  });

  it('returns a successful payload when the request resolves', async () => {
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
