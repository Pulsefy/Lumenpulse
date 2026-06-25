import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * GET /api/status
 *
 * Server-side proxy to the NestJS backend GET /health/status endpoint.
 * Ensures backend URLs are not exposed to the browser.
 */
export async function GET(): Promise<NextResponse> {
  const backendUrl = `${BACKEND_API_URL}/health/status`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(backendUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `[/api/status] backend returned ${response.status}`,
      );
      return NextResponse.json(
        { error: `Backend status endpoint returned ${response.status}` },
        { status: 502 },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/status] proxy error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch status from backend' },
      { status: 502 },
    );
  }
}
