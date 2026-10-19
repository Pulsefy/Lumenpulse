import { NextResponse } from 'next/server';
import type { Wallet } from '@/contexts/WalletContext';
import { DEFAULT_WALLETS } from './default-wallets';

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * GET /api/wallets
 *
 * Resolves the connected / configured wallets from the backend if available,
 * or serves default Stellar wallets.
 */
export async function GET(): Promise<NextResponse> {
  const backendUrl = `${BACKEND_API_URL}/wallets`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(backendUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const wallets: Wallet[] = Array.isArray(data?.wallets)
        ? data.wallets
        : Array.isArray(data)
          ? data
          : DEFAULT_WALLETS;

      return NextResponse.json(wallets);
    }
  } catch {
    // Backend unavailable or request timed out; fall back to default wallets
  }

  return NextResponse.json(DEFAULT_WALLETS);
}
