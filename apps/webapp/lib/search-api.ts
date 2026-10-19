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
import { clientConfig } from '@/lib/config';

export type SearchCategory =
  | 'projects'
  | 'assets'
  | 'ecosystem'
  | 'entity-links';

export interface ProjectSearchItem {
  projectId: number;
  name: string;
  ownerPublicKey: string;
  status: string;
  score: number;
}

export interface ProjectSearchResponse {
  items: ProjectSearchItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssetSearchItem {
  assetCode: string;
  assetIssuer: string;
  assetType?: string;
  numAccounts?: number;
  totalSupply?: string;
}

export interface AssetSearchResponse {
  assets: AssetSearchItem[];
  total?: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface EcosystemSearchItem {
  kind: 'tag' | 'category';
  value: string;
  count?: number;
}

export interface EcosystemSearchResponse {
  items: EcosystemSearchItem[];
}

export interface EntityLinksResponse {
  projects: Array<{ projectId: number; name: string; matchedMention: string }>;
  assets: Array<{ assetCode: string; assetIssuer: string; matchedMention: string }>;
  ecosystem: Array<{
    kind: 'tag' | 'category';
    value: string;
    matchedMention: string;
  }>;
}

export interface GlobalSearchResultItem {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle?: string;
  href: string;
}

export interface GlobalSearchGroup {
  category: SearchCategory;
  label: string;
  count: number;
  items: GlobalSearchResultItem[];
}

export interface GlobalSearchResults {
  groups: GlobalSearchGroup[];
  totalCount: number;
}

const BASE_URL = clientConfig.apiUrl;

async function getJson<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ||
        `Search request failed (${response.status}) for ${path}`,
    );
  }
  return response.json() as Promise<T>;
}

export function hrefForProject(projectId: number): string {
  return `/projects/${projectId}`;
}

export function hrefForAsset(assetCode: string, assetIssuer?: string): string {
  const params = new URLSearchParams();
  if (assetIssuer) params.set('issuer', assetIssuer);
  const qs = params.toString();
  return `/assets/${encodeURIComponent(assetCode)}${qs ? `?${qs}` : ''}`;
}

export function hrefForEcosystem(
  kind: 'tag' | 'category',
  value: string,
): string {
  const params = new URLSearchParams();
  params.set(kind, value);
  return `/news?${params.toString()}`;
}

export function hrefForContributor(address: string): string {
  return `/contributor/${address}`;
}

/**
 * Run the four backend search endpoints in parallel and normalize into
 * grouped, navigable result items.
 */
export async function runGlobalSearch(
  query: string,
  signal?: AbortSignal,
  limitPerType = 5,
): Promise<GlobalSearchResults> {
  const q = query.trim();
  if (!q) {
    return { groups: [], totalCount: 0 };
  }

  const [projectsSettled, assetsSettled, ecosystemSettled, entitySettled] =
    await Promise.allSettled([
      getJson<ProjectSearchResponse>(
        '/search/projects',
        { q, limit: limitPerType, offset: 0 },
        signal,
      ),
      getJson<AssetSearchResponse>(
        '/search/assets',
        { q, limit: limitPerType },
        signal,
      ),
      getJson<EcosystemSearchResponse>(
        '/search/ecosystem',
        { q, limit: limitPerType, includeCounts: 'true' },
        signal,
      ),
      getJson<EntityLinksResponse>(
        '/search/entity-links',
        { text: q, limitPerType },
        signal,
      ),
    ]);

  // Surface hard failures (non-abort) so the UI can show an error state.
  const failures = [
    projectsSettled,
    assetsSettled,
    ecosystemSettled,
    entitySettled,
  ].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

  const aborted = failures.some(
    (f) =>
      (f.reason instanceof DOMException && f.reason.name === 'AbortError') ||
      (f.reason &&
        typeof f.reason === 'object' &&
        'name' in f.reason &&
        (f.reason as { name: string }).name === 'AbortError'),
  );
  if (aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  if (failures.length === 4) {
    throw failures[0].reason instanceof Error
      ? failures[0].reason
      : new Error('All search endpoints failed');
  }

  const projects =
    projectsSettled.status === 'fulfilled' ? projectsSettled.value : null;
  const assets =
    assetsSettled.status === 'fulfilled' ? assetsSettled.value : null;
  const ecosystem =
    ecosystemSettled.status === 'fulfilled' ? ecosystemSettled.value : null;
  const entityLinks =
    entitySettled.status === 'fulfilled' ? entitySettled.value : null;

  const projectItems: GlobalSearchResultItem[] = (projects?.items ?? []).map(
    (item) => ({
      id: `project-${item.projectId}`,
      category: 'projects' as const,
      title: item.name,
      subtitle: `Status: ${item.status} · Owner ${item.ownerPublicKey.slice(0, 4)}…${item.ownerPublicKey.slice(-4)}`,
      href: hrefForProject(item.projectId),
    }),
  );

  const assetItems: GlobalSearchResultItem[] = (assets?.assets ?? []).map(
    (item) => ({
      id: `asset-${item.assetCode}-${item.assetIssuer}`,
      category: 'assets' as const,
      title: item.assetCode,
      subtitle: item.assetIssuer
        ? `Issuer ${item.assetIssuer.slice(0, 4)}…${item.assetIssuer.slice(-4)}${
            item.numAccounts != null ? ` · ${item.numAccounts} accounts` : ''
          }`
        : undefined,
      href: hrefForAsset(item.assetCode, item.assetIssuer),
    }),
  );

  const ecosystemItems: GlobalSearchResultItem[] = (
    ecosystem?.items ?? []
  ).map((item) => ({
    id: `ecosystem-${item.kind}-${item.value}`,
    category: 'ecosystem' as const,
    title: item.value,
    subtitle:
      item.count != null
        ? `${item.kind} · ${item.count} mentions`
        : item.kind,
    href: hrefForEcosystem(item.kind, item.value),
  }));

  const entityItems: GlobalSearchResultItem[] = [
    ...(entityLinks?.projects ?? []).map((item) => ({
      id: `entity-project-${item.projectId}-${item.matchedMention}`,
      category: 'entity-links' as const,
      title: item.name,
      subtitle: `Linked project · matched “${item.matchedMention}”`,
      href: hrefForProject(item.projectId),
    })),
    ...(entityLinks?.assets ?? []).map((item) => ({
      id: `entity-asset-${item.assetCode}-${item.assetIssuer}-${item.matchedMention}`,
      category: 'entity-links' as const,
      title: item.assetCode,
      subtitle: `Linked asset · matched “${item.matchedMention}”`,
      href: hrefForAsset(item.assetCode, item.assetIssuer),
    })),
    ...(entityLinks?.ecosystem ?? []).map((item) => ({
      id: `entity-ecosystem-${item.kind}-${item.value}-${item.matchedMention}`,
      category: 'entity-links' as const,
      title: item.value,
      subtitle: `Linked ${item.kind} · matched “${item.matchedMention}”`,
      href: hrefForEcosystem(item.kind, item.value),
    })),
  ];

  const groups: GlobalSearchGroup[] = [
    {
      category: 'projects',
      label: 'Projects',
      count: projects?.total ?? projectItems.length,
      items: projectItems,
    },
    {
      category: 'assets',
      label: 'Assets',
      count: assets?.total ?? assetItems.length,
      items: assetItems,
    },
    {
      category: 'ecosystem',
      label: 'Ecosystem',
      count: ecosystemItems.length,
      items: ecosystemItems,
    },
    {
      category: 'entity-links',
      label: 'Entity links',
      count: entityItems.length,
      items: entityItems,
    },
  ];

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  return { groups, totalCount };
}
