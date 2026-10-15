import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { apiClient, ApiResponse } from './api-client';

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

export interface ToggleWatchlistResult {
  added: boolean;
  item?: WatchlistItem;
}

export interface ConflictInfo {
  symbol: string;
  type: WatchlistItemType;
  localItem?: WatchlistItem;
  serverItem?: WatchlistItem;
  resolution: 'local_won' | 'server_won';
}

export interface RollbackInfo {
  symbol: string;
  type: WatchlistItemType;
  previousState: 'added' | 'removed';
  reason: string;
}

interface PendingOperation {
  id: string;
  type: 'add' | 'remove' | 'toggle';
  payload: AddToWatchlistPayload;
  timestamp: number;
}

const PENDING_SYNC_KEY_PREFIX = 'watchlist_pending_sync';
const LOCAL_WATCHLIST_KEY_PREFIX = 'watchlist_local_cache';
const LAST_SYNCED_KEY_PREFIX = 'watchlist_last_synced';

function pendingSyncKey(userId?: string): string {
  return userId ? `${PENDING_SYNC_KEY_PREFIX}_${userId}` : PENDING_SYNC_KEY_PREFIX;
}

function localWatchlistKey(userId?: string): string {
  return userId ? `${LOCAL_WATCHLIST_KEY_PREFIX}_${userId}` : LOCAL_WATCHLIST_KEY_PREFIX;
}

function lastSyncedKey(userId?: string): string {
  return userId ? `${LAST_SYNCED_KEY_PREFIX}_${userId}` : LAST_SYNCED_KEY_PREFIX;
}

export const watchlistApi = {
  async getWatchlist(type?: WatchlistItemType): Promise<ApiResponse<WatchlistResponse>> {
    const params = type ? `?type=${type}` : '';
    return apiClient.get<WatchlistResponse>(`/watchlist${params}`);
  },

  async addItem(payload: AddToWatchlistPayload): Promise<ApiResponse<WatchlistItem>> {
    return apiClient.post<WatchlistItem>('/watchlist', payload);
  },

  async toggleItem(payload: AddToWatchlistPayload): Promise<ApiResponse<ToggleWatchlistResult>> {
    return apiClient.post<ToggleWatchlistResult>('/watchlist/toggle', payload);
  },

  async removeItem(itemId: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/watchlist/${itemId}`);
  },

  async updateItem(
    itemId: string,
    updates: { name?: string; notes?: string; imageUrl?: string; sortOrder?: number },
  ): Promise<ApiResponse<WatchlistItem>> {
    return apiClient.patch<WatchlistItem>(`/watchlist/${itemId}`, updates);
  },

  async reorderItems(itemIds: string[]): Promise<ApiResponse<WatchlistResponse>> {
    return apiClient.patch<WatchlistResponse>('/watchlist/reorder', { itemIds });
  },

  async checkSymbol(
    symbol: string,
    type?: WatchlistItemType,
  ): Promise<ApiResponse<{ inWatchlist: boolean }>> {
    const params = `?symbol=${encodeURIComponent(symbol)}${type ? `&type=${type}` : ''}`;
    return apiClient.get<{ inWatchlist: boolean }>(`/watchlist/check${params}`);
  },
};

export async function getPendingOperationsCount(userId?: string): Promise<number> {
  const ops = await getPendingOperations(userId);
  return ops.length;
}

async function getPendingOperations(userId?: string): Promise<PendingOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(pendingSyncKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function savePendingOperations(ops: PendingOperation[], userId?: string): Promise<void> {
  await AsyncStorage.setItem(pendingSyncKey(userId), JSON.stringify(ops));
}

async function addPendingOperation(op: Omit<PendingOperation, 'id' | 'timestamp'>, userId?: string): Promise<void> {
  const ops = await getPendingOperations(userId);
  ops.push({
    ...op,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: Date.now(),
  });
  await savePendingOperations(ops, userId);
}

async function removePendingOperation(id: string, userId?: string): Promise<void> {
  const ops = await getPendingOperations(userId);
  await savePendingOperations(ops.filter((o) => o.id !== id), userId);
}

async function processSyncQueue(userId?: string): Promise<{
  resolved: number;
  failed: PendingOperation[];
  conflicts: ConflictInfo[];
}> {
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    return { resolved: 0, failed: [], conflicts: [] };
  }

  const ops = await getPendingOperations(userId);
  if (ops.length === 0) {
    return { resolved: 0, failed: [], conflicts: [] };
  }

  const resolved: PendingOperation[] = [];
  const failed: PendingOperation[] = [];
  const conflicts: ConflictInfo[] = [];

  for (const op of ops) {
    try {
      if (op.type === 'toggle') {
        const res = await watchlistApi.toggleItem(op.payload);
        if (res.success) {
          resolved.push(op);
          if (res.data?.added && res.data.item) {
            await addToLocalWatchlist(res.data.item, userId);
          } else {
            await removeFromLocalWatchlist(op.payload.symbol, op.payload.type, userId);
          }
        } else if (res.error?.statusCode === 409) {
          const localItem = (await getLocalWatchlist(userId))
            .find((i) => i.symbol === op.payload.symbol && i.type === op.payload.type);
          conflicts.push({
            symbol: op.payload.symbol,
            type: op.payload.type,
            localItem,
            resolution: 'server_won',
          });
          resolved.push(op);
        } else {
          failed.push(op);
        }
      } else if (op.type === 'add') {
        const res = await watchlistApi.addItem(op.payload);
        if (res.success) {
          resolved.push(op);
          if (res.data) {
            await addToLocalWatchlist(res.data, userId);
          }
        } else if (res.error?.statusCode === 409) {
          const serverItems = await watchlistApi.getWatchlist(op.payload.type);
          const serverItem = serverItems.success ? serverItems.data?.items.find(
            (i) => i.symbol === op.payload.symbol && i.type === op.payload.type
          ) : undefined;
          if (serverItem) {
            await addToLocalWatchlist(serverItem, userId);
          }
          resolved.push(op);
        } else {
          failed.push(op);
        }
      } else if (op.type === 'remove') {
        const res = await watchlistApi.toggleItem(op.payload);
        if (res.success) {
          resolved.push(op);
          await removeFromLocalWatchlist(op.payload.symbol, op.payload.type, userId);
        } else {
          failed.push(op);
        }
      }
    } catch {
      failed.push(op);
    }
  }

  const remaining = ops.filter((op) => !resolved.find((r) => r.id === op.id));
  await savePendingOperations(remaining, userId);

  return {
    resolved: resolved.length,
    failed,
    conflicts,
  };
}

export async function getLocalWatchlist(userId?: string): Promise<WatchlistItem[]> {
  try {
    const raw = await AsyncStorage.getItem(localWatchlistKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function setLocalWatchlist(items: WatchlistItem[], userId?: string): Promise<void> {
  await AsyncStorage.setItem(localWatchlistKey(userId), JSON.stringify(items));
}

export async function clearLocalWatchlist(userId?: string): Promise<void> {
  await AsyncStorage.removeItem(localWatchlistKey(userId));
}

export async function addToLocalWatchlist(item: WatchlistItem, userId?: string): Promise<void> {
  const items = await getLocalWatchlist(userId);
  const idx = items.findIndex((i) => i.symbol === item.symbol && i.type === item.type);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.unshift(item);
  }
  await setLocalWatchlist(items, userId);
}

export async function removeFromLocalWatchlist(
  symbol: string,
  type: WatchlistItemType,
  userId?: string,
): Promise<void> {
  const items = await getLocalWatchlist(userId);
  await setLocalWatchlist(
    items.filter((i) => !(i.symbol === symbol && i.type === type)),
    userId,
  );
}

async function saveLastSyncedAt(userId?: string): Promise<void> {
  await AsyncStorage.setItem(lastSyncedKey(userId), new Date().toISOString());
}

export async function getLastSyncedAt(userId?: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastSyncedKey(userId));
  } catch {
    return null;
  }
}

function compareTimestamps(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

function mergeWatchlists(
  server: WatchlistItem[],
  local: WatchlistItem[],
): { items: WatchlistItem[]; conflicts: ConflictInfo[]; rollbacks: RollbackInfo[] } {
  const serverMap = new Map<string, WatchlistItem>();
  const localMap = new Map<string, WatchlistItem>();
  const conflicts: ConflictInfo[] = [];
  const rollbacks: RollbackInfo[] = [];

  for (const item of server) {
    serverMap.set(`${item.symbol}_${item.type}`, item);
  }
  for (const item of local) {
    localMap.set(`${item.symbol}_${item.type}`, item);
  }

  const merged = new Map<string, WatchlistItem>();

  for (const [key, serverItem] of serverMap) {
    const localItem = localMap.get(key);
    if (!localItem) {
      merged.set(key, serverItem);
      continue;
    }

    const serverTime = new Date(serverItem.updatedAt).getTime();
    const localTime = new Date(localItem.updatedAt).getTime();

    if (localTime > serverTime) {
      const localPending = localItem.id.startsWith('local_');
      if (localPending) {
        conflicts.push({
          symbol: serverItem.symbol,
          type: serverItem.type,
          localItem,
          serverItem,
          resolution: 'local_won',
        });
        merged.set(key, localItem);
      } else {
        merged.set(key, localItem);
      }
    } else if (serverTime > localTime) {
      if (!localItem.id.startsWith('local_') && !serverItem.id.startsWith('local_')) {
        rollbacks.push({
          symbol: serverItem.symbol,
          type: serverItem.type,
          previousState: 'removed',
          reason: `Server version is newer (${serverItem.updatedAt} vs ${localItem.updatedAt})`,
        });
      }
      merged.set(key, serverItem);
    } else {
      merged.set(key, serverItem);
    }
  }

  for (const [key, localItem] of localMap) {
    if (!serverMap.has(key)) {
      merged.set(key, localItem);
    }
  }

  return {
    items: Array.from(merged.values()).sort((a, b) => a.sortOrder - b.sortOrder),
    conflicts,
    rollbacks,
  };
}

export async function syncAndGetWatchlist(
  userId?: string,
): Promise<{
  items: WatchlistItem[];
  localOnly: number;
  conflicts: ConflictInfo[];
  rollbacks: RollbackInfo[];
}> {
  const syncResult = await processSyncQueue(userId);

  const netState = await NetInfo.fetch();
  if (netState.isConnected) {
    const response = await watchlistApi.getWatchlist();
    if (response.success && response.data) {
      const serverItems = response.data.items;
      const localItems = await getLocalWatchlist(userId);
      const { items, conflicts, rollbacks } = mergeWatchlists(serverItems, localItems);

      const allConflicts = [...syncResult.conflicts, ...conflicts];
      await setLocalWatchlist(items, userId);
      await saveLastSyncedAt(userId);

      return {
        items,
        localOnly: 0,
        conflicts: allConflicts,
        rollbacks,
      };
    }
  }

  const cached = await getLocalWatchlist(userId);
  return {
    items: cached,
    localOnly: 0,
    conflicts: syncResult.conflicts,
    rollbacks: [],
  };
}

export async function toggleWatchlistItem(
  payload: AddToWatchlistPayload,
  userId?: string,
): Promise<{ added: boolean; error?: string; conflict?: boolean }> {
  const netState = await NetInfo.fetch();

  if (netState.isConnected) {
    const response = await watchlistApi.toggleItem(payload);
    if (response.success && response.data) {
      if (response.data.added && response.data.item) {
        await addToLocalWatchlist(response.data.item, userId);
      } else {
        await removeFromLocalWatchlist(payload.symbol, payload.type, userId);
      }
      await saveLastSyncedAt(userId);
      return { added: response.data.added };
    }
    if (response.error?.statusCode === 409) {
      return { added: false, error: 'Conflict detected', conflict: true };
    }
  }

  const localItems = await getLocalWatchlist(userId);
  const exists = localItems.find((i) => i.symbol === payload.symbol && i.type === payload.type);

  if (exists) {
    await removeFromLocalWatchlist(payload.symbol, payload.type, userId);
  } else {
    const optimisticItem: WatchlistItem = {
      id: `local_${Date.now()}`,
      userId: userId || '',
      symbol: payload.symbol,
      name: payload.name || null,
      type: payload.type,
      assetIssuer: payload.assetIssuer || null,
      imageUrl: payload.imageUrl || null,
      notes: payload.notes || null,
      sortOrder: payload.sortOrder || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await addToLocalWatchlist(optimisticItem, userId);
  }

  await addPendingOperation({ type: 'toggle', payload }, userId);
  return { added: !exists, error: netState.isConnected ? undefined : 'Queued for sync when online' };
}

export async function clearWatchlistData(userId?: string): Promise<void> {
  await clearLocalWatchlist(userId);
  await AsyncStorage.removeItem(pendingSyncKey(userId));
  await AsyncStorage.removeItem(lastSyncedKey(userId));
}
