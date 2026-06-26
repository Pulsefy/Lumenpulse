export const WatchlistItemType = {
  ASSET: 'asset',
  PROJECT: 'project',
} as const;

export type WatchlistItemType = (typeof WatchlistItemType)[keyof typeof WatchlistItemType];

export interface WatchlistItem {
  id: string;
  userId: string;
  symbol: string;
  name: string | null;
  type: WatchlistItemType;
  assetIssuer: string | null;
  imageUrl: string | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  total: number;
}

export interface AddToWatchlistPayload {
  symbol: string;
  name?: string;
  type: WatchlistItemType;
  assetIssuer?: string;
  imageUrl?: string;
  notes?: string;
  sortOrder?: number;
}

export interface UpdateWatchlistPayload {
  name?: string;
  imageUrl?: string;
  notes?: string;
  sortOrder?: number;
}

export interface ToggleWatchlistResult {
  added: boolean;
  item?: WatchlistItem;
}

export class WatchlistApiService {
  private static readonly BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  private static getAuthHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return {};
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  static async getWatchlist(
    type?: WatchlistItemType,
  ): Promise<WatchlistResponse> {
    const params = type ? `?type=${type}` : '';
    const response = await fetch(`${this.BASE_URL}/watchlist${params}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch watchlist');
    }

    return response.json();
  }

  static async addItem(
    payload: AddToWatchlistPayload,
  ): Promise<WatchlistItem> {
    const response = await fetch(`${this.BASE_URL}/watchlist`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to add item to watchlist');
    }

    return response.json();
  }

  static async toggleItem(
    payload: AddToWatchlistPayload,
  ): Promise<ToggleWatchlistResult> {
    const response = await fetch(`${this.BASE_URL}/watchlist/toggle`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to toggle watchlist item');
    }

    return response.json();
  }

  static async updateItem(
    itemId: string,
    payload: UpdateWatchlistPayload,
  ): Promise<WatchlistItem> {
    const response = await fetch(`${this.BASE_URL}/watchlist/${itemId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to update watchlist item');
    }

    return response.json();
  }

  static async removeItem(itemId: string): Promise<void> {
    const response = await fetch(`${this.BASE_URL}/watchlist/${itemId}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to remove watchlist item');
    }
  }

  static async reorderItems(itemIds: string[]): Promise<WatchlistResponse> {
    const response = await fetch(`${this.BASE_URL}/watchlist/reorder`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ itemIds }),
    });

    if (!response.ok) {
      throw new Error('Failed to reorder watchlist items');
    }

    return response.json();
  }

  static async checkSymbol(
    symbol: string,
    type?: WatchlistItemType,
  ): Promise<{ inWatchlist: boolean }> {
    const params = `?symbol=${encodeURIComponent(symbol)}${type ? `&type=${type}` : ''}`;
    const response = await fetch(
      `${this.BASE_URL}/watchlist/check${params}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      throw new Error('Failed to check watchlist');
    }

    return response.json();
  }
}
