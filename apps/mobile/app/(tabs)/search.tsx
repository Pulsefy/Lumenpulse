import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ListError from '../../components/ListError';
import ListSkeleton from '../../components/ListSkeleton';
import { useLocalization } from '../../src/context';
import { SearchResults, searchApi } from '../../lib/search';
import { addRecentSearch, getRecentSearches } from '../../lib/search-history';
import { SavedSearch, savedSearchesApi } from '../../lib/saved-searches';

const DEBOUNCE_MS = 350;

export default function SearchScreen() {
  const { colors, t } = useLocalization();
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchLoading, setSavedSearchLoading] = useState(true);
  const [savedSearchError, setSavedSearchError] = useState<string | null>(null);
  const [savedSearchActionError, setSavedSearchActionError] = useState<string | null>(null);
  const [editingSearch, setEditingSearch] = useState<SavedSearch | null>(null);
  const [searchName, setSearchName] = useState('');
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  const recentLoadErrorMessage = t('search.recent_load_error');
  const searchErrorMessage = t('search.error_message');

  const loadSavedSearches = useCallback(async () => {
    setSavedSearchLoading(true);
    try {
      setSavedSearches(await savedSearchesApi.list());
      setSavedSearchError(null);
    } catch (loadError) {
      setSavedSearchError(
        loadError instanceof Error ? loadError.message : t('search.saved_searches_load_error'),
      );
    } finally {
      setSavedSearchLoading(false);
    }
  }, [t]);

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
    void loadSavedSearches();
  }, [loadSavedSearches]);

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
  const openCreateSearch = useCallback(() => {
    setEditingSearch(null);
    setSearchName(query.trim());
    setSavedSearchActionError(null);
    setSearchModalVisible(true);
  }, [query]);
  const openRenameSearch = useCallback((saved: SavedSearch) => {
    setEditingSearch(saved);
    setSearchName(saved.name);
    setSavedSearchActionError(null);
    setSearchModalVisible(true);
  }, []);
  const submitSavedSearch = useCallback(async () => {
    const name = searchName.trim();
    if (!name || savingSearch) return;

    setSavingSearch(true);
    setSavedSearchActionError(null);
    try {
      if (editingSearch) {
        await savedSearchesApi.update(editingSearch.id, { name });
      } else {
        await savedSearchesApi.create({
          name,
          domain: 'projects',
          filters: { q: query.trim() },
        });
      }
      setSearchModalVisible(false);
      await loadSavedSearches();
    } catch (saveError) {
      setSavedSearchActionError(
        saveError instanceof Error
          ? saveError.message
          : t(editingSearch ? 'search.update_search_error' : 'search.save_search_error'),
      );
    } finally {
      setSavingSearch(false);
    }
  }, [editingSearch, loadSavedSearches, query, savingSearch, searchName, t]);
  const toggleSubscription = useCallback(
    async (saved: SavedSearch) => {
      setSavedSearchActionError(null);
      try {
        await savedSearchesApi.update(saved.id, { isSubscribed: !saved.isSubscribed });
        await loadSavedSearches();
      } catch (updateError) {
        setSavedSearchActionError(
          updateError instanceof Error ? updateError.message : t('search.update_search_error'),
        );
      }
    },
    [loadSavedSearches, t],
  );
  const deleteSavedSearch = useCallback(
    (saved: SavedSearch) => {
      Alert.alert(t('search.delete_search_title'), t('search.delete_search_message'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('search.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSavedSearchActionError(null);
              try {
                await savedSearchesApi.remove(saved.id);
                await loadSavedSearches();
              } catch (deleteError) {
                setSavedSearchActionError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : t('search.delete_search_error'),
                );
              }
            })();
          },
        },
      ]);
    },
    [loadSavedSearches, t],
  );
  const runSavedSearch = useCallback((saved: SavedSearch) => {
    const savedQuery = saved.filters.q;
    if (typeof savedQuery === 'string') setQuery(savedQuery);
  }, []);
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

      {query.trim() ? (
        <TouchableOpacity
          style={[styles.saveSearchButton, { backgroundColor: colors.accent }]}
          onPress={openCreateSearch}
          accessibilityRole="button"
          accessibilityLabel={t('search.save_search')}
        >
          <Ionicons name="bookmark-outline" size={18} color={colors.surface} />
          <Text style={[styles.saveSearchButtonText, { color: colors.surface }]}>
            {t('search.save_search')}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.savedSearchSection}>
        {renderGroupHeader(t('search.saved_searches'), savedSearches.length)}
        {savedSearchActionError ? (
          <Text style={[styles.actionError, { color: colors.danger }]} accessibilityRole="alert">
            {savedSearchActionError}
          </Text>
        ) : null}
        {savedSearchLoading ? (
          <ListSkeleton count={2} />
        ) : savedSearchError ? (
          <ListError message={savedSearchError} onRetry={() => void loadSavedSearches()} />
        ) : savedSearches.length === 0 ? (
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {t('search.saved_searches_empty')}
          </Text>
        ) : (
          savedSearches.map((saved) => (
            <View
              key={saved.id}
              style={[styles.savedSearchRow, { borderBottomColor: colors.border }]}
            >
              <TouchableOpacity
                style={styles.savedSearchDetails}
                onPress={() => runSavedSearch(saved)}
                accessibilityRole="button"
                accessibilityLabel={t('search.repeat_search', {
                  query: typeof saved.filters.q === 'string' ? saved.filters.q : saved.name,
                })}
              >
                <Text style={[styles.savedSearchName, { color: colors.text }]} numberOfLines={1}>
                  {saved.name}
                </Text>
                <Text
                  style={[styles.resultSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {typeof saved.filters.q === 'string' ? saved.filters.q : saved.domain}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => void toggleSubscription(saved)}
                accessibilityRole="button"
                accessibilityLabel={t(
                  saved.isSubscribed ? 'search.notifications_on' : 'search.notifications_off',
                )}
              >
                <Ionicons
                  name={saved.isSubscribed ? 'notifications' : 'notifications-outline'}
                  size={19}
                  color={saved.isSubscribed ? colors.accent : colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => openRenameSearch(saved)}
                accessibilityRole="button"
                accessibilityLabel={`${t('search.rename')}: ${saved.name}`}
              >
                <Ionicons name="pencil-outline" size={19} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.savedSearchAction}
                onPress={() => deleteSavedSearch(saved)}
                accessibilityRole="button"
                accessibilityLabel={`${t('search.delete')}: ${saved.name}`}
              >
                <Ionicons name="trash-outline" size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))
        )}
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

      <Modal
        visible={searchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
              {t(editingSearch ? 'search.rename_search_title' : 'search.save_search_title')}
            </Text>
            <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>
              {t('search.search_name')}
            </Text>
            <TextInput
              value={searchName}
              onChangeText={setSearchName}
              placeholder={t('search.search_name_placeholder')}
              placeholderTextColor={colors.textSecondary}
              style={[styles.modalInput, { color: colors.text, borderColor: colors.cardBorder }]}
              maxLength={120}
              autoFocus
              accessibilityLabel={t('search.search_name')}
            />
            {savedSearchActionError ? (
              <Text
                style={[styles.actionError, { color: colors.danger }]}
                accessibilityRole="alert"
              >
                {savedSearchActionError}
              </Text>
            ) : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setSearchModalVisible(false)}
                style={styles.modalButton}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.textSecondary }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void submitSavedSearch()}
                style={[styles.modalButton, { backgroundColor: colors.accent }]}
                disabled={!searchName.trim() || savingSearch}
                accessibilityRole="button"
              >
                <Text style={{ color: colors.surface }}>
                  {t(editingSearch ? 'search.rename' : 'search.save')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  saveSearchButton: {
    minHeight: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  saveSearchButtonText: { fontSize: 15, fontWeight: '600' },
  savedSearchSection: { marginBottom: 12 },
  savedSearchRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  savedSearchDetails: { flex: 1, paddingVertical: 8 },
  savedSearchName: { fontSize: 15, fontWeight: '500' },
  savedSearchAction: {
    minWidth: 38,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionError: { paddingVertical: 8, fontSize: 13 },
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
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: { borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  modalLabel: { fontSize: 13, marginBottom: 6 },
  modalInput: { minHeight: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 20 },
  modalButton: {
    minHeight: 40,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 12,
  },
});
