import { ApiClient, ApiResponse } from '../api-client';
import { SearchApi } from '../search';

describe('SearchApi', () => {
  const get = jest.fn();
  const api = new SearchApi({ get } as unknown as Pick<ApiClient, 'get'>);

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockImplementation((path: string) => {
      if (path.startsWith('/search/projects')) {
        return Promise.resolve(success({ items: [{ projectId: 1, name: 'Lumen' }] }));
      }
      if (path.startsWith('/search/assets')) {
        return Promise.resolve(success({ assets: [{ assetCode: 'XLM' }] }));
      }
      if (path.includes('kind=tag')) {
        return Promise.resolve(success({ items: [{ kind: 'tag', value: 'stellar' }] }));
      }
      if (path.includes('kind=category')) {
        return Promise.resolve(success({ items: [{ kind: 'category', value: 'defi' }] }));
      }
      return Promise.resolve(success({ projects: [], assets: [], ecosystem: [] }));
    });
  });

  it('queries every search route and groups the results by API category', async () => {
    const controller = new AbortController();
    const results = await api.search('stellar pulse', controller.signal);

    expect(get).toHaveBeenCalledTimes(5);
    expect(get).toHaveBeenCalledWith('/search/projects?q=stellar+pulse&limit=10&offset=0', {
      signal: controller.signal,
    });
    expect(get).toHaveBeenCalledWith('/search/entity-links?text=stellar+pulse&limitPerType=5', {
      signal: controller.signal,
    });
    expect(results.projects[0].name).toBe('Lumen');
    expect(results.assets[0].assetCode).toBe('XLM');
    expect(results.ecosystem.map((entity) => entity.kind)).toEqual(['tag', 'category']);
  });

  it('surfaces failed endpoint requests', async () => {
    get.mockResolvedValueOnce({
      success: false,
      error: { message: 'Search is unavailable' },
    } satisfies ApiResponse<unknown>);

    await expect(api.search('stellar')).rejects.toThrow('Search is unavailable');
  });
});

function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}
