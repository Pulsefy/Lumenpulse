import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * GET /api/news
 *
 * Server-side proxy to the NestJS backend news endpoint.
 * API keys never leave the server — the browser only calls this route.
 *
 * Supported query params: limit, lang, tag, category
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  // Forward only the params the backend understands
  const forwardedParams = new URLSearchParams();
  for (const key of ['limit', 'lang', 'tag', 'category']) {
    const value = searchParams.get(key);
    if (value !== null) forwardedParams.set(key, value);
  }

  const backendUrl = `${BACKEND_API_URL}/news${forwardedParams.size > 0 ? `?${forwardedParams.toString()}` : ''}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(backendUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/news] proxy error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch news from backend' },
      { status: 502 },
    );
  }
}
