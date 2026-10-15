import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ListError from '../../components/ListError';
import ListSkeleton from '../../components/ListSkeleton';
import { useLocalization } from '../../src/context';
import { SearchResults, searchApi } from '../../lib/search';
import { addRecentSearch, getRecentSearches } from '../../lib/search-history';

const DEBOUNCE_MS = 350;

export default function SearchScreen() {
  const { colors, t } = useLocalization();
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  const recentLoadErrorMessage = t('search.recent_load_error');
  const searchErrorMessage = t('search.error_message');

  useEffect(() => {
    let active = true;
    getRecentSearches()
      .then((recent) => {
        if (active) {
          setRecentSearches(recent);
          setHistoryError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setHistoryError(loadError instanceof Error ? loadError.message : recentLoadErrorMessage);
        }
      });

    return () => {
      active = false;
    };
  }, [historyRetry, recentLoadErrorMessage]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    setResults(null);
    setError(null);
    setLoading(false);

    if (!trimmedQuery) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setLoading(true);
      void searchApi
        .search(trimmedQuery, controller.signal)
        .then(async (nextResults) => {
          if (controller.signal.aborted) return;
          setResults(nextResults);
          setRecentSearches(await addRecentSearch(trimmedQuery));
        })
        .catch((searchError: unknown) => {
          if (!controller.signal.aborted) {
            setError(searchError instanceof Error ? searchError.message : searchErrorMessage);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, retryAttempt, searchErrorMessage]);

  const retry = useCallback(() => setRetryAttempt((attempt) => attempt + 1), []);
  const retryRecentSearches = useCallback(() => setHistoryRetry((attempt) => attempt + 1), []);
  const totalResults = useMemo(() => {
    if (!results) return 0;
    return (
      results.projects.length +
      results.assets.length +
      results.ecosystem.length +
      results.entityLinks.projects.length +
      results.entityLinks.assets.length +
      results.entityLinks.ecosystem.length
    );
  }, [results]);
  const linkedResultCount = results
    ? results.entityLinks.projects.length +
      results.entityLinks.assets.length +
      results.entityLinks.ecosystem.length
    : 0;

  const renderGroupHeader = (title: string, count: number) => (
    <View style={[styles.groupHeader, { borderBottomColor: colors.border }]}>
      <Text style={[styles.groupTitle, { color: colors.text }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.count, { color: colors.textSecondary }]}>{count}</Text>
    </View>
  );

  const renderRow = (title: string, subtitle?: string, key?: string) => (
    <View key={key ?? title} style={[styles.resultRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.resultSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={[
          styles.searchBox,
          { backgroundColor: colors.surface, borderColor: colors.cardBorder },
        ]}
      >
        <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('search.placeholder')}
          testID="search-input"
        />
        {query.length > 0 ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={t('search.clear_query')}
          >
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {!query.trim() ? (
        <View>
          {historyError ? (
            <ListError message={historyError} onRetry={retryRecentSearches} />
          ) : recentSearches.length > 0 ? (
            <>
              {renderGroupHeader(t('search.recent_title'), recentSearches.length)}
              {recentSearches.map((recent) => (
                <TouchableOpacity
                  key={recent}
                  style={[styles.recentRow, { borderBottomColor: colors.border }]}
                  onPress={() => setQuery(recent)}
                  accessibilityRole="button"
                  accessibilityLabel={t('search.repeat_search', { query: recent })}
                >
                  <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.recentText, { color: colors.text }]} numberOfLines={1}>
                    {recent}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {t('search.prompt')}
            </Text>
          )}
        </View>
      ) : loading ? (
        <ListSkeleton count={5} />
      ) : error ? (
        <ListError message={error} onRetry={retry} />
      ) : results && totalResults === 0 ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {t('search.no_results')}
        </Text>
      ) : results ? (
        <View>
          {renderGroupHeader(t('search.projects'), results.projects.length)}
          {results.projects.map((project) =>
            renderRow(
              project.name,
              `#${project.projectId} · ${project.status}`,
              `project-${project.projectId}`,
            ),
          )}

          {renderGroupHeader(t('search.assets'), results.assets.length)}
          {results.assets.map((asset) =>
            renderRow(
              asset.assetCode,
              asset.assetIssuer,
              `asset-${asset.assetCode}-${asset.assetIssuer}`,
            ),
          )}

          {renderGroupHeader(t('search.ecosystem'), results.ecosystem.length)}
          {results.ecosystem.map((entity) =>
            renderRow(
              entity.value,
              `${t(`search.${entity.kind}`)}${entity.count === undefined ? '' : ` · ${entity.count}`}`,
              `ecosystem-${entity.kind}-${entity.value}`,
            ),
          )}

          {renderGroupHeader(t('search.entity_links'), linkedResultCount)}
          {results.entityLinks.projects.map((project) =>
            renderRow(
              project.name,
              t('search.matched_mention', { mention: project.matchedMention }),
              `linked-project-${project.projectId}`,
            ),
          )}
          {results.entityLinks.assets.map((asset) =>
            renderRow(
              asset.assetCode,
              t('search.matched_mention', { mention: asset.matchedMention }),
              `linked-asset-${asset.assetCode}-${asset.assetIssuer}`,
            ),
          )}
          {results.entityLinks.ecosystem.map((entity) =>
            renderRow(
              entity.value,
              t('search.matched_mention', { mention: entity.matchedMention }),
              `linked-ecosystem-${entity.kind}-${entity.value}`,
            ),
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  searchBox: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  input: { flex: 1, minHeight: 46, fontSize: 16 },
  groupHeader: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  groupTitle: { fontSize: 16, fontWeight: '600' },
  count: { fontSize: 14 },
  resultRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  resultTitle: { fontSize: 15, fontWeight: '500' },
  resultSubtitle: { fontSize: 12, marginTop: 4 },
  recentRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentText: { flex: 1, fontSize: 15 },
  message: { textAlign: 'center', paddingHorizontal: 20, paddingVertical: 28, fontSize: 15 },
});
