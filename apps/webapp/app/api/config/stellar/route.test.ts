import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { StellarConfig } from '@/types/stellar-config'

const MOCK_CONFIG: StellarConfig = {
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contracts: {
    lumenToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    crowdfundVault: null,
    projectRegistry: null,
    contributorRegistry: null,
    matchingPool: null,
    treasury: null,
  },
}

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      body,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}))

describe('GET /api/config/stellar', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('BACKEND_API_URL', 'http://backend:3001')
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('proxies a successful backend response with cache headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
    )
    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.body).toEqual(MOCK_CONFIG)
    expect(((res.headers as unknown) as Record<string, string>)['Cache-Control']).toContain('max-age=300')
  })

  it('returns 502 when backend returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('error', { status: 500 })
    )
    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(502)
  })

  it('returns 502 when fetch throws (backend unreachable)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(502)
    expect(((res.body as unknown) as { error: string }).error).toContain('Failed to fetch')
  })

  it('uses BACKEND_API_URL env var for the backend request', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
    )
    const { GET } = await import('./route')
    await GET()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://backend:3001/v1/config/stellar',
      expect.any(Object)
    )
  })

  it('falls back to localhost:3001 when BACKEND_API_URL is not set', async () => {
    vi.unstubAllEnvs()
    delete process.env.BACKEND_API_URL
    vi.resetModules()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
    )
    const { GET } = await import('./route')
    await GET()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:3001/v1/config/stellar',
      expect.any(Object)
    )
  })
})
