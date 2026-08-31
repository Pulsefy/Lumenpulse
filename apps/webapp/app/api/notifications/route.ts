import { NextResponse } from 'next/server';

const fallbackItems = [
  {
    id: 'fallback-1',
    title: 'Grant milestone updated',
    body: 'The review team advanced your proposal to the next milestone.',
    destination: '/grants',
    read: false,
    type: 'grant',
    createdAt: '2026-07-27T10:00:00.000Z',
  },
  {
    id: 'fallback-2',
    title: 'Transaction confirmed',
    body: 'Your latest contribution transaction has been finalized on Stellar.',
    destination: '/dashboard',
    read: true,
    type: 'transaction',
    createdAt: '2026-07-26T16:30:00.000Z',
  },
];

import { serverConfig } from '@/lib/config';

export async function GET() {
  const backendUrl = serverConfig.backendApiUrl;

  try {
    const response = await fetch(`${backendUrl}/notifications`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Backend unavailable: ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload)
        ? payload
        : [];

    return NextResponse.json({ items, source: 'backend' });
  } catch {
    return NextResponse.json({ items: fallbackItems, source: 'fallback' });
  }
}
