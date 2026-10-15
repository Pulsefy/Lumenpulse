import { ApiClient, ApiResponse, apiClient } from './api-client';

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
  assetType: string;
  numAccounts?: number;
  totalSupply?: string;
}

export interface AssetSearchResponse {
  assets: AssetSearchItem[];
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

export interface EcosystemSearchItem {
  kind: 'tag' | 'category';
  value: string;
  count?: number;
}

export interface EcosystemSearchResponse {
  items: EcosystemSearchItem[];
}

export interface EntityLinkingResponse {
  projects: { projectId: number; name: string; matchedMention: string }[];
  assets: { assetCode: string; assetIssuer: string; matchedMention: string }[];
  ecosystem: { kind: 'tag' | 'category'; value: string; matchedMention: string }[];
}

export interface SearchResults {
  projects: ProjectSearchItem[];
  assets: AssetSearchItem[];
  ecosystem: EcosystemSearchItem[];
  entityLinks: EntityLinkingResponse;
}

const queryString = (values: Record<string, string | number | boolean>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, String(value));
  }
  return params.toString();
};

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(response.error?.message ?? 'Search request failed');
  }
  if (response.data === undefined) {
    throw new Error('Search response was empty');
  }
  return response.data;
}

export class SearchApi {
  constructor(private readonly client: Pick<ApiClient, 'get'> = apiClient) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResults> {
    const common = { q: query, limit: 10 };
    const [projects, assets, tags, categories, entityLinks] = await Promise.all([
      this.client.get<ProjectSearchResponse>(
        `/search/projects?${queryString({ ...common, offset: 0 })}`,
        { signal },
      ),
      this.client.get<AssetSearchResponse>(`/search/assets?${queryString(common)}`, { signal }),
      this.client.get<EcosystemSearchResponse>(
        `/search/ecosystem?${queryString({ ...common, kind: 'tag', includeCounts: true })}`,
        { signal },
      ),
      this.client.get<EcosystemSearchResponse>(
        `/search/ecosystem?${queryString({ ...common, kind: 'category', includeCounts: true })}`,
        { signal },
      ),
      this.client.get<EntityLinkingResponse>(
        `/search/entity-links?${queryString({ text: query, limitPerType: 5 })}`,
        { signal },
      ),
    ]);

    return {
      projects: requireData(projects).items,
      assets: requireData(assets).assets,
      ecosystem: [...requireData(tags).items, ...requireData(categories).items],
      entityLinks: requireData(entityLinks),
    };
  }
}

export const searchApi = new SearchApi();
