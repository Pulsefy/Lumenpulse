import { clientConfig } from '@/lib/config';

/** Mirrors `SavedSearchDomain` in apps/backend/src/saved-searches. */
export type SavedSearchDomain = 'grants' | 'projects' | 'news';

export const SAVED_SEARCH_DOMAINS: readonly SavedSearchDomain[] = ['grants', 'projects', 'news'];

export const SAVED_SEARCH_NAME_MAX = 120;

export type SavedSearchFilters = Record<string, unknown>;

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  domain: SavedSearchDomain;
  filters: SavedSearchFilters;
  isSubscribed: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedSearchPayload {
  name: string;
  domain: SavedSearchDomain;
  filters: SavedSearchFilters;
  isSubscribed?: boolean;
}

export type UpdateSavedSearchPayload = Partial<CreateSavedSearchPayload>;

export class SavedSearchApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SavedSearchApiError';
  }
}

export function normalizeSavedSearch(raw: Record<string, unknown>): SavedSearch {
  const domain = SAVED_SEARCH_DOMAINS.includes(raw.domain as SavedSearchDomain)
    ? (raw.domain as SavedSearchDomain)
    : 'projects';
  return {
    id: String(raw.id),
    userId: String(raw.userId ?? ''),
    name: String(raw.name ?? ''),
    domain,
    filters:
      raw.filters && typeof raw.filters === 'object' ? (raw.filters as SavedSearchFilters) : {},
    isSubscribed: Boolean(raw.isSubscribed),
    lastNotifiedAt: (raw.lastNotifiedAt as string | null | undefined) ?? null,
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

/** Returns an error message, or null when the name is acceptable to the API. */
export function validateSavedSearchName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name.';
  if (trimmed.length > SAVED_SEARCH_NAME_MAX) {
    return `Use at most ${SAVED_SEARCH_NAME_MAX} characters.`;
  }
  return null;
}

// ─── Global search <-> saved filters ─────────────────────────────────────────

/** Saved searches created from the navbar search use the `projects` domain. */
export const GLOBAL_SEARCH_DOMAIN: SavedSearchDomain = 'projects';

/** Window event the global search listens for to restore a saved search. */
export const RUN_SAVED_SEARCH_EVENT = 'lumenpulse:run-saved-search';

export interface RunSavedSearchDetail {
  filters: SavedSearchFilters;
}

export function filtersFromGlobalQuery(query: string): SavedSearchFilters {
  return { q: query.trim() };
}

export function globalQueryFromFilters(filters: SavedSearchFilters): string {
  return typeof filters.q === 'string' ? filters.q : '';
}

/**
 * Where to re-run a saved search. Searches the navbar search can replay
 * (domain `projects` with a `q`) return null and are dispatched to it with
 * {@link RUN_SAVED_SEARCH_EVENT}; any other search opens its domain page with
 * every stored filter as a query parameter.
 */
export function savedSearchHref(search: SavedSearch): string | null {
  if (search.domain === GLOBAL_SEARCH_DOMAIN && globalQueryFromFilters(search.filters)) {
    return null;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search.filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const qs = params.toString();
  return `/${search.domain}${qs ? `?${qs}` : ''}`;
}

export function dispatchRunSavedSearch(filters: SavedSearchFilters): void {
  window.dispatchEvent(
    new CustomEvent<RunSavedSearchDetail>(RUN_SAVED_SEARCH_EVENT, { detail: { filters } }),
  );
}

// ─── API client ──────────────────────────────────────────────────────────────

async function toApiError(res: Response, fallback: string): Promise<SavedSearchApiError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  if (res.status === 401) {
    return new SavedSearchApiError('Sign in to use saved searches.', res.status);
  }
  return new SavedSearchApiError(message || fallback, res.status);
}

export class SavedSearchApiService {
  private static readonly BASE_URL = clientConfig.apiUrl;

  private static getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (typeof document === 'undefined') return headers;
    const match = document.cookie.split('; ').find((row) => row.startsWith('auth-token='));
    const token = match?.split('=')[1];
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  static async list(domain?: SavedSearchDomain): Promise<SavedSearch[]> {
    const qs = domain ? `?domain=${encodeURIComponent(domain)}` : '';
    const res = await fetch(`${this.BASE_URL}/saved-searches${qs}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to load saved searches');
    const data = (await res.json()) as { items?: Record<string, unknown>[] };
    return (data.items ?? []).map(normalizeSavedSearch);
  }

  static async create(payload: CreateSavedSearchPayload): Promise<SavedSearch> {
    const res = await fetch(`${this.BASE_URL}/saved-searches`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ ...payload, name: payload.name.trim() }),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to save search');
    return normalizeSavedSearch(await res.json());
  }

  static async update(id: string, payload: UpdateSavedSearchPayload): Promise<SavedSearch> {
    const body = payload.name !== undefined ? { ...payload, name: payload.name.trim() } : payload;
    const res = await fetch(`${this.BASE_URL}/saved-searches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to update saved search');
    return normalizeSavedSearch(await res.json());
  }

  static async remove(id: string): Promise<void> {
    const res = await fetch(`${this.BASE_URL}/saved-searches/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw await toApiError(res, 'Failed to delete saved search');
  }
}
