import { clientConfig } from '@/lib/config';

export interface UserSession {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  locationHint: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export class SessionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SessionApiError';
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof document === 'undefined') return headers;
  const match = document.cookie.split('; ').find((row) => row.startsWith('auth-token='));
  const token = match?.split('=')[1];
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function toError(res: Response, fallback: string): Promise<SessionApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return new SessionApiError(message || fallback, res.status);
}

export function normalizeSession(raw: Record<string, unknown>): UserSession {
  return {
    id: String(raw.id),
    deviceInfo: (raw.deviceInfo as string | null | undefined) ?? null,
    ipAddress: (raw.ipAddress as string | null | undefined) ?? null,
    locationHint: (raw.locationHint as string | null | undefined) ?? null,
    lastSeenAt: (raw.lastSeenAt as string | null | undefined) ?? null,
    createdAt: String(raw.createdAt ?? ''),
    expiresAt: String(raw.expiresAt ?? ''),
    isCurrent: Boolean(raw.isCurrent),
  };
}

export class SessionApiService {
  private static readonly BASE_URL = clientConfig.apiUrl;

  static async list(): Promise<UserSession[]> {
    const res = await fetch(`${this.BASE_URL}/auth/sessions`, { headers: authHeaders() });
    if (!res.ok) throw await toError(res, 'Failed to load sessions');
    const data = (await res.json()) as { sessions?: Record<string, unknown>[] };
    return (data.sessions ?? []).map(normalizeSession);
  }

  static async revoke(id: string): Promise<void> {
    const res = await fetch(`${this.BASE_URL}/auth/sessions/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) throw await toError(res, 'Failed to revoke session');
  }

  static async revokeAll(): Promise<void> {
    const res = await fetch(`${this.BASE_URL}/auth/logout-all`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) throw await toError(res, 'Failed to revoke sessions');
  }
}
