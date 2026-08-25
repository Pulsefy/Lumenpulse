import { NextResponse } from 'next/server';

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const backendUrl = process.env.BACKEND_API_URL ?? 'http://localhost:3001';

  try {
    const response = await fetch(`${backendUrl}/notifications/${params.id}/read`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Backend unavailable: ${response.status}`);
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({
      id: params.id,
      read: true,
    });
  }
}
