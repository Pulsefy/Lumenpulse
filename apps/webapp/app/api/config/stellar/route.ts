import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * GET /api/config/stellar
 *
 * Server-side proxy to the NestJS backend GET /v1/config/stellar endpoint.
 * The browser calls this route; the backend URL never leaks to the client.
 */
export async function GET(): Promise<NextResponse> {
  const backendUrl = `${BACKEND_API_URL}/v1/config/stellar`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(backendUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      // Opt out of Next.js fetch cache so the config is always fresh on cold start
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `[/api/config/stellar] backend returned ${response.status}`,
      );
      return NextResponse.json(
        { error: `Backend returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();

    // Cache the response for 5 minutes on the CDN / Next.js cache layer
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/config/stellar] proxy error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch Stellar config from backend' },
      { status: 502 },
    );
  }
}
