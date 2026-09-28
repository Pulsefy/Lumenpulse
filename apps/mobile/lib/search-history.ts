import AsyncStorage from '@react-native-async-storage/async-storage';

export const RECENT_SEARCHES_STORAGE_KEY = 'lumenpulse.search.recent';
export const MAX_RECENT_SEARCHES = 10;

export async function getRecentSearches(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
  if (!stored) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, MAX_RECENT_SEARCHES);
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return getRecentSearches();

  const recent = await getRecentSearches();
  const next = [
    normalizedQuery,
    ...recent.filter((entry) => entry.toLowerCase() !== normalizedQuery.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);

  await AsyncStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  await AsyncStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
}
