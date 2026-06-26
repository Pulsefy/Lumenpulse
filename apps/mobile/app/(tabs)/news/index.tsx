import React, { useState } from 'react';
import {
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  View,
  RefreshControl,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '@/lib/api-client';
import { useTheme } from '@/contexts/ThemeContext';
import { Article } from '@/lib/types/news';
import { useCachedData } from '@/hooks/useCachedData';
import { CACHE_CONFIGS } from '@/lib/cache';
import { useLocalization } from '@/src/context';

export default function NewsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: articles,
    loading,
    error,
    refresh,
    isStale,
  } = useCachedData({
    key: 'news_1_20',
    fetcher: async () => {
      const response = await apiClient.get<Article[]>('/news');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to load news');
    },
    ...CACHE_CONFIGS.NEWS,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: { item: Article }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/news/${item.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${item.title}. ${item.source}. ${new Date(item.publishedAt).toLocaleString()}`}
      accessibilityHint="Double tap to read article"
    >
      <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
        {item.title}
      </Text>
      <Text style={[styles.meta, { color: colors.text }]} accessible>
        {item.source} • {new Date(item.publishedAt).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator
          size="large"
          color="#db74cf"
          accessible
          accessibilityLabel={t('common.loading')}
        />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={styles.error} accessible accessibilityRole="alert">
          {error.message}
        </Text>
        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          <Text style={styles.retryText} accessible>{t('common.retry')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push('/news/saved')}
              style={{ marginRight: 16 }}
              accessibilityRole="link"
              accessibilityLabel={t('news.saved')}
              accessibilityHint="View saved articles"
            >
              <Ionicons name="bookmark-outline" size={24} color={colors.text} />
            </TouchableOpacity>
          ),
        }}
      />

      {isStale && (
        <View
          style={[styles.staleIndicator, { backgroundColor: colors.warning + '22' }]}
          accessible
          accessibilityLabel={t('news.showing_cached')}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text style={[styles.staleText, { color: colors.warning }]} accessible>
            {t('news.showing_cached')}
          </Text>
        </View>
      )}

      <FlatList
        data={articles || []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh news"
          />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.center} accessible accessibilityLabel="No news available">
              <Text style={{ color: colors.text }}>{t('news.no_news')}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ margin: 20 }} /> : null}
        accessibilityLabel={t('news.title')}
        accessibilityRole="list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  meta: {
    opacity: 0.6,
    fontSize: 12,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    color: '#ff6b6b',
    marginBottom: 12,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#db74cf',
    borderRadius: 8,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  staleIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  staleText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
  },
});
