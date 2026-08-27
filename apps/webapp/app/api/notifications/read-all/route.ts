import { NextResponse } from 'next/server';

import { serverConfig } from '@/lib/config';

export async function POST() {
  const backendUrl = serverConfig.backendApiUrl;

  try {
    const response = await fetch(`${backendUrl}/notifications/read-all`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Backend unavailable: ${response.status}`);
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ items: [] });
  }
}
