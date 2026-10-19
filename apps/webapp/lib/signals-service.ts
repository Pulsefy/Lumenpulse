import { clientConfig } from '@/lib/config';

export type SignalCategory = 'holdings' | 'activity' | 'risk' | 'fallback';
export type SignalSeverity = 'low' | 'medium' | 'high';

export interface UserSignalDto {
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  detail: string;
}

export interface UserSignalsResponse {
  userId: string;
  generatedAt: string;
  signals: UserSignalDto[];
}

export class SignalsApiService {
  private static readonly BASE_URL = clientConfig.apiUrl;

  private static getAuthHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return { 'Content-Type': 'application/json' };
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  static isAuthenticated(): boolean {
    if (typeof document === 'undefined') return false;
    return document.cookie.split('; ').some((row) => row.startsWith('auth-token='));
  }

  static async getLatestSignals(signal?: AbortSignal): Promise<UserSignalsResponse> {
    const response = await fetch(`${this.BASE_URL}/signals/latest`, {
      headers: this.getAuthHeaders(),
      signal,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message =
        (err as Record<string, unknown>)?.message ||
        `Signals fetch failed (${response.status})`;
      throw new Error(message as string);
    }
    return response.json();
  }
}
