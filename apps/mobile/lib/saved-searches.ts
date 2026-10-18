import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiResponse, apiClient } from './api-client';
import { mutationQueue, QueuedMutation, MutationReplayOutcome } from './mutation-queue';

const SAVED_SEARCHES_CACHE_KEY = 'lumenpulse.saved-searches.cache';
const SAVED_SEARCHES_ID_MAP_KEY = 'lumenpulse.saved-searches.id-map';
const CREATE_MUTATION = 'saved-searches.create';
const UPDATE_MUTATION = 'saved-searches.update';
const DELETE_MUTATION = 'saved-searches.delete';

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  domain: 'grants' | 'projects' | 'news';
  filters: Record<string, unknown>;
  isSubscribed: boolean;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSearchUpdate {
  name?: string;
  isSubscribed?: boolean;
}

interface SavedSearchListResponse {
  items: SavedSearch[];
  total: number;
}

interface SavedSearchCreateInput {
  name: string;
  domain: SavedSearch['domain'];
  filters: Record<string, unknown>;
  isSubscribed?: boolean;
}

const requireData = <T>(response: ApiResponse<T>, operation: string): T => {
  if (!response.success) {
    throw new Error(response.error?.message ?? `${operation} failed`);
  }
  if (response.data === undefined) {
    throw new Error(`${operation} returned no data`);
  }
  return response.data;
};

const isNetworkFailure = (response: ApiResponse<unknown>): boolean =>
  response.error?.error === 'NetworkError';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isSavedSearch = (value: unknown): value is SavedSearch => {
  if (!isRecord(value)) return false;
  const validDomain =
    value.domain === 'grants' || value.domain === 'projects' || value.domain === 'news';
  return (
    typeof value.id === 'string' &&
    typeof value.userId === 'string' &&
    typeof value.name === 'string' &&
    validDomain &&
    isRecord(value.filters) &&
    typeof value.isSubscribed === 'boolean' &&
    (typeof value.lastNotifiedAt === 'string' || value.lastNotifiedAt === null) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
};

const isSavedSearchUpdate = (value: unknown): value is SavedSearchUpdate => {
  if (!isRecord(value)) return false;
  return (
    (value.name === undefined || typeof value.name === 'string') &&
    (value.isSubscribed === undefined || typeof value.isSubscribed === 'boolean')
  );
};

const readCache = async (): Promise<SavedSearch[]> => {
  const cached = await AsyncStorage.getItem(SAVED_SEARCHES_CACHE_KEY);
  if (!cached) return [];

  const parsed: unknown = JSON.parse(cached);
  if (!Array.isArray(parsed) || !parsed.every(isSavedSearch)) {
    throw new Error('Saved searches cache has an invalid format');
  }
  return parsed;
};

const writeCache = async (items: SavedSearch[]): Promise<void> => {
  await AsyncStorage.setItem(SAVED_SEARCHES_CACHE_KEY, JSON.stringify(items));
};

const readIdMap = async (): Promise<Record<string, string>> => {
  const stored = await AsyncStorage.getItem(SAVED_SEARCHES_ID_MAP_KEY);
  if (!stored) return {};

  const parsed: unknown = JSON.parse(stored);
  if (!isStringRecord(parsed)) {
    throw new Error('Saved searches ID map has an invalid format');
  }
  return parsed;
};

const upsert = (items: SavedSearch[], next: SavedSearch): SavedSearch[] => {
  const existingIndex = items.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) return [next, ...items];
  return items.map((item) => (item.id === next.id ? next : item));
};

const getMutationId = (mutation: QueuedMutation): string | null =>
  typeof mutation.payload.id === 'string' ? mutation.payload.id : null;

async function applyQueuedChanges(items: SavedSearch[]): Promise<SavedSearch[]> {
  const [queue, idMap] = await Promise.all([mutationQueue.getQueue(), readIdMap()]);
  let visible = [...items];

  for (const mutation of queue) {
    const id = getMutationId(mutation);
    const resolvedId = id ? (idMap[id] ?? id) : null;

    if (mutation.type === CREATE_MUTATION) {
      const item = mutation.payload.search;
      if (isSavedSearch(item)) {
        visible = upsert(visible, item);
      }
    } else if (mutation.type === UPDATE_MUTATION && resolvedId) {
      const updates = mutation.payload.updates;
      if (isSavedSearchUpdate(updates)) {
        visible = visible.map((item) => (item.id === resolvedId ? { ...item, ...updates } : item));
      }
    } else if (mutation.type === DELETE_MUTATION && resolvedId) {
      visible = visible.filter((item) => item.id !== resolvedId);
    }
  }

  return visible;
}

async function saveServerSearch(search: SavedSearch): Promise<void> {
  await writeCache(upsert(await readCache(), search));
}

async function getRemoteId(id: string): Promise<string> {
  const idMap = await readIdMap();
  return idMap[id] ?? id;
}

async function hasQueuedCreate(id: string): Promise<boolean> {
  if (!id.startsWith('offline-')) return false;
  const queue = await mutationQueue.getQueue();
  return queue.some(
    (mutation) =>
      mutation.type === CREATE_MUTATION &&
      isSavedSearch(mutation.payload.search) &&
      mutation.payload.search.id === id,
  );
}

export const savedSearchesApi = {
  async list(): Promise<SavedSearch[]> {
    const response = await apiClient.get<SavedSearchListResponse>('/saved-searches');
    if (response.success) {
      const remote = requireData(response, 'Loading saved searches').items;
      await writeCache(remote);
      return applyQueuedChanges(remote);
    }
    if (!isNetworkFailure(response)) {
      throw new Error(response.error?.message ?? 'Loading saved searches failed');
    }
    return applyQueuedChanges(await readCache());
  },

  async create(input: SavedSearchCreateInput): Promise<void> {
    const response = await apiClient.post<SavedSearch>('/saved-searches', {
      ...input,
      isSubscribed: input.isSubscribed ?? false,
    });

    if (response.success) {
      await saveServerSearch(requireData(response, 'Saving search'));
      return;
    }
    if (!isNetworkFailure(response)) {
      throw new Error(response.error?.message ?? 'Saving search failed');
    }

    const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const optimisticSearch: SavedSearch = {
      id,
      userId: '',
      ...input,
      isSubscribed: input.isSubscribed ?? false,
      lastNotifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await mutationQueue.enqueue({
      type: CREATE_MUTATION,
      payload: { search: optimisticSearch },
    });
  },

  async update(id: string, updates: SavedSearchUpdate): Promise<void> {
    if (await hasQueuedCreate(id)) {
      await mutationQueue.enqueue({
        type: UPDATE_MUTATION,
        payload: { id, updates },
      });
      return;
    }

    const serverId = await getRemoteId(id);
    const response = await apiClient.patch<SavedSearch>(
      `/saved-searches/${encodeURIComponent(serverId)}`,
      updates,
    );

    if (response.success) {
      await saveServerSearch(requireData(response, 'Updating saved search'));
      return;
    }
    if (!isNetworkFailure(response)) {
      throw new Error(response.error?.message ?? 'Updating saved search failed');
    }

    await mutationQueue.enqueue({
      type: UPDATE_MUTATION,
      payload: { id, updates },
    });
  },

  async remove(id: string): Promise<void> {
    if (await hasQueuedCreate(id)) {
      await mutationQueue.enqueue({
        type: DELETE_MUTATION,
        payload: { id },
      });
      return;
    }

    const serverId = await getRemoteId(id);
    const response = await apiClient.delete<void>(
      `/saved-searches/${encodeURIComponent(serverId)}`,
    );

    if (response.success) {
      await writeCache((await readCache()).filter((item) => item.id !== serverId));
      return;
    }
    if (!isNetworkFailure(response)) {
      throw new Error(response.error?.message ?? 'Deleting saved search failed');
    }

    await mutationQueue.enqueue({
      type: DELETE_MUTATION,
      payload: { id },
    });
  },
};

export async function replaySavedSearchMutation(
  mutation: QueuedMutation,
): Promise<MutationReplayOutcome> {
  if (mutation.type === CREATE_MUTATION) {
    const search = mutation.payload.search;
    if (!isSavedSearch(search)) {
      return { status: 'failed', error: 'Queued saved search is invalid' };
    }

    const local = search;
    const input: SavedSearchCreateInput = {
      name: local.name,
      domain: local.domain,
      filters: local.filters,
      isSubscribed: local.isSubscribed,
    };
    const response = await apiClient.post<SavedSearch>('/saved-searches', input);
    if (!response.success || !response.data) {
      return { status: 'failed', error: response.error?.message ?? 'Saving search failed' };
    }

    const serverSearch = response.data;
    const idMap = await readIdMap();
    idMap[local.id] = serverSearch.id;
    await AsyncStorage.setItem(SAVED_SEARCHES_ID_MAP_KEY, JSON.stringify(idMap));
    await saveServerSearch(serverSearch);
    return { status: 'applied', serverValue: serverSearch };
  }

  const id = getMutationId(mutation);
  if (!id) return { status: 'failed', error: 'Queued saved search ID is missing' };
  const serverId = await getRemoteId(id);

  if (mutation.type === UPDATE_MUTATION) {
    const updates = mutation.payload.updates;
    if (!isSavedSearchUpdate(updates)) {
      return { status: 'failed', error: 'Queued saved search update is invalid' };
    }
    const response = await apiClient.patch<SavedSearch>(
      `/saved-searches/${encodeURIComponent(serverId)}`,
      updates,
    );
    if (!response.success || !response.data) {
      return { status: 'failed', error: response.error?.message ?? 'Updating saved search failed' };
    }
    await saveServerSearch(response.data);
    return { status: 'applied', serverValue: response.data };
  }

  if (mutation.type === DELETE_MUTATION) {
    const response = await apiClient.delete<void>(
      `/saved-searches/${encodeURIComponent(serverId)}`,
    );
    if (!response.success) {
      return { status: 'failed', error: response.error?.message ?? 'Deleting saved search failed' };
    }
    await writeCache((await readCache()).filter((item) => item.id !== serverId));
    return { status: 'applied' };
  }

  return { status: 'failed', error: `Unsupported saved search mutation: ${mutation.type}` };
}
