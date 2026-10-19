/**
 * Client for the backend /saved-searches REST API.
 *
 * Mirrors the structure of watchlist-service.ts so the patterns across
 * the codebase stay consistent.  Auth token is read from the auth-token
 * cookie (set by the login flow) and forwarded in every mutating request.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Types — mirror the backend SavedSearchResponseDto
// ---------------------------------------------------------------------------

export interface SavedSearchFilters {
  /** e.g. 'project' | 'asset' | 'ecosystem' */
  kind?: string;
  /** Verification status (project searches) */
  status?: string;
  /** Stellar public key of the project owner */
  ownerPublicKey?: string;
  /** Any other filter fields the search module accepts */
  [key: string]: unknown;
}

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: string;
  filters: SavedSearchFilters;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearchListResponse {
  items: SavedSearch[];
  total: number;
}

export interface CreateSavedSearchPayload {
  name: string;
  query?: string;
  filters?: SavedSearchFilters;
  notificationsEnabled?: boolean;
}

export interface UpdateSavedSearchPayload {
  name?: string;
  query?: string;
  filters?: SavedSearchFilters;
  notificationsEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return { 'Content-Type': 'application/json' };
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('auth-token='));
  const token = match?.split('=')[1];
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ||
        `Request failed with status ${res.status}`,
    );
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export class SavedSearchesApiService {
  /** Retrieve all saved searches for the authenticated user. */
  static async list(): Promise<SavedSearchListResponse> {
    const res = await fetch(`${BASE_URL}/saved-searches`, {
      headers: getAuthHeaders(),
    });
    return handleResponse<SavedSearchListResponse>(res);
  }

  /** Save the current search under a name. */
  static async create(
    payload: CreateSavedSearchPayload,
  ): Promise<SavedSearch> {
    const res = await fetch(`${BASE_URL}/saved-searches`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse<SavedSearch>(res);
  }

  /**
   * Rename the saved search or change its query / filters / notification
   * setting.  All fields are optional.
   */
  static async update(
    id: string,
    payload: UpdateSavedSearchPayload,
  ): Promise<SavedSearch> {
    const res = await fetch(`${BASE_URL}/saved-searches/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse<SavedSearch>(res);
  }

  /** Delete a saved search. */
  static async remove(id: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/saved-searches/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { message?: string }).message ||
          `Delete failed with status ${res.status}`,
      );
    }
  }

  /**
   * Subscribe or unsubscribe from notifications for a saved search.
   * The backend flips the `notificationsEnabled` flag and returns the updated search.
   */
  static async setNotifications(
    id: string,
    enabled: boolean,
  ): Promise<SavedSearch> {
    const res = await fetch(
      `${BASE_URL}/saved-searches/${id}/notifications`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled }),
      },
    );
    return handleResponse<SavedSearch>(res);
  }
}
