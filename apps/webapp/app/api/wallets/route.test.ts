import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_WALLETS } from './default-wallets';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      body,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}));

describe('GET /api/wallets', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('BACKEND_API_URL', 'http://backend:3001');
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('proxies wallets from backend when backend returns 200 with wallet list', async () => {
    const customWallets = [
      {
        id: 'custom-1',
        label: 'Custom Wallet',
        address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        chain: 'XLM',
        balance: '500 XLM',
        balanceUSD: 60,
        change24h: '+1.0%',
        changePositive: true,
        assetCount: 1,
      },
    ];

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(customWallets), { status: 200 })
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(customWallets);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://backend:3001/wallets',
      expect.any(Object)
    );
  });

  it('falls back to DEFAULT_WALLETS when backend returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_WALLETS);
  });

  it('falls back to DEFAULT_WALLETS when backend fetch rejects (unreachable)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_WALLETS);
  });
});
