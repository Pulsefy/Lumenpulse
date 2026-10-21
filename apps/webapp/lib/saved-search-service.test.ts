import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SavedSearchApiError,
  SavedSearchApiService,
  filtersFromGlobalQuery,
  globalQueryFromFilters,
  normalizeSavedSearch,
  savedSearchHref,
  validateSavedSearchName,
} from './saved-search-service';

const RAW = {
  id: 's1',
  userId: 'u1',
  name: 'Lumen',
  domain: 'projects',
  filters: { q: 'lumen' },
  isSubscribed: false,
  lastNotifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'auth-token=test-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

describe('SavedSearchApiService', () => {
  it('list: GETs /saved-searches with the bearer token and unwraps items', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [RAW], total: 1 }));
    const items = await SavedSearchApiService.list();
    const { url, init } = lastCall();
    expect(url).toMatch(/\/saved-searches$/);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect(items).toEqual([RAW]);
  });

  it('list: passes the domain filter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));
    await SavedSearchApiService.list('news');
    expect(lastCall().url).toMatch(/\/saved-searches\?domain=news$/);
  });

  it('create: POSTs a trimmed name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RAW, 201));
    await SavedSearchApiService.create({ name: '  Lumen ', domain: 'projects', filters: { q: 'lumen' } });
    const { init } = lastCall();
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Lumen', domain: 'projects', filters: { q: 'lumen' } });
  });

  it('update: PATCHes /saved-searches/:id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...RAW, isSubscribed: true }));
    const updated = await SavedSearchApiService.update('s1', { isSubscribed: true });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/saved-searches\/s1$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ isSubscribed: true });
    expect(updated.isSubscribed).toBe(true);
  });

  it('remove: DELETEs /saved-searches/:id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await SavedSearchApiService.remove('s1');
    expect(lastCall().init.method).toBe('DELETE');
  });

  it('surfaces API errors with their status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Saved search limit reached' }, 403));
    const err = await SavedSearchApiService.create({ name: 'x', domain: 'news', filters: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(SavedSearchApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Saved search limit reached');
  });
});

describe('filters', () => {
  it('round-trips the global search query exactly', () => {
    expect(globalQueryFromFilters(filtersFromGlobalQuery('  Stellar DeFi '))).toBe('Stellar DeFi');
  });

  it('routes non-global searches to their domain page with every filter', () => {
    const search = normalizeSavedSearch({ ...RAW, domain: 'grants', filters: { status: 'active', keyword: 'DeFi' } });
    expect(savedSearchHref(search)).toBe('/grants?status=active&keyword=DeFi');
    expect(savedSearchHref(normalizeSavedSearch(RAW))).toBeNull();
  });

  it('validates names against the API limits', () => {
    expect(validateSavedSearchName('  ')).toBe('Enter a name.');
    expect(validateSavedSearchName('a'.repeat(121))).toMatch(/120/);
    expect(validateSavedSearchName('ok')).toBeNull();
  });
});
