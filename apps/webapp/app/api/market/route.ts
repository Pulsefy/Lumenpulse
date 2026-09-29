import { NextRequest, NextResponse } from 'next/server';
import { CryptoApiData } from '@/lib/api-services';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const REQUEST_TIMEOUT_MS = 15_000;
const REVALIDATE_SECONDS = 120;

interface CachedEntry {
  data: CryptoApiData[];
  timestamp: number;
}

let fallbackCache: CachedEntry | null = null;

export interface MarketResponseShape {
  data: CryptoApiData[];
  cachedAt?: string;
  stale?: boolean;
  error?: {
    code: string;
    message: string;
    upstreamStatus?: number;
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const upstreamUrl = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h,24h,7d`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(upstreamUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: REVALIDATE_SECONDS },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body: MarketResponseShape = {
        data: fallbackCache?.data ?? [],
        cachedAt: fallbackCache ? new Date(fallbackCache.timestamp).toISOString() : undefined,
        stale: Boolean(fallbackCache),
        error: {
          code: 'UPSTREAM_ERROR',
          message: `CoinGecko returned HTTP ${response.status}`,
          upstreamStatus: response.status,
        },
      };
      return NextResponse.json(body, {
        status: fallbackCache ? 200 : 502,
        headers: fallbackCache
          ? { 'X-Cache': 'STALE' }
          : { 'X-Cache': 'MISS' },
      });
    }

    const data = (await response.json()) as CryptoApiData[];
    fallbackCache = { data, timestamp: Date.now() };

    const body: MarketResponseShape = {
      data,
      cachedAt: new Date(fallbackCache.timestamp).toISOString(),
    };
    return NextResponse.json(body, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': `s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate` },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/market] proxy error:', message);

    if (fallbackCache) {
      const body: MarketResponseShape = {
        data: fallbackCache.data,
        cachedAt: new Date(fallbackCache.timestamp).toISOString(),
        stale: true,
        error: {
          code: 'UPSTREAM_UNREACHABLE',
          message,
        },
      };
      return NextResponse.json(body, {
        status: 200,
        headers: { 'X-Cache': 'STALE' },
      });
    }

    const body: MarketResponseShape = {
      data: [],
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: 'Failed to fetch market data from CoinGecko',
      },
    };
    return NextResponse.json(body, { status: 502 });
  }
}
