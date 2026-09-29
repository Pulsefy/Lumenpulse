import React, { useState } from 'react';
import {
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  View,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '@/lib/api-client';
import { useTheme } from '@/contexts/ThemeContext';
import { Article } from '@/lib/types/news';
import { useCachedData } from '@/hooks/useCachedData';
import { CACHE_CONFIGS } from '@/lib/cache';
import { useLocalization } from '@/src/context';
import StandardList from '@/components/StandardList';
import CachedImage from '@/components/CachedImage';

// Fixed card height lets StandardList pass getItemLayout to FlatList, which
// eliminates per-item measurement — the primary source of scroll jank on
// low-end devices. This value must match the rendered card exactly.
const CARD_PADDING_V = 12;
const THUMBNAIL_SIZE = 72;
const CARD_MARGIN_BOTTOM = 8;
export const NEWS_ITEM_HEIGHT =
  THUMBNAIL_SIZE + CARD_PADDING_V * 2 + CARD_MARGIN_BOTTOM;

function NewsCard({
  item,
  onPress,
  colors,
}: {
  item: Article;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          height: THUMBNAIL_SIZE + CARD_PADDING_V * 2,
        },
      ]}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${item.title}. ${item.source}. ${new Date(item.publishedAt).toLocaleString()}`}
      accessibilityHint="Double tap to read article"
    >
      <View style={styles.cardBody}>
        <View style={styles.cardText}>
          <Text
            style={[styles.title, { color: colors.text }]}
            numberOfLines={2}
            accessible
            accessibilityRole="header"
          >
            {item.title}
          </Text>
          <Text style={[styles.meta, { color: colors.text }]} accessible numberOfLines={1}>
            {item.source} • {new Date(item.publishedAt).toLocaleString()}
          </Text>
        </View>

        {/* Fixed dimensions prevent layout shift while the image resolves */}
        <CachedImage
          uri={item.imageUrl}
          width={THUMBNAIL_SIZE}
          height={THUMBNAIL_SIZE}
          borderRadius={8}
          accessibilityLabel={item.imageUrl ? `${item.title} thumbnail` : undefined}
        />
      </View>
    </TouchableOpacity>
  );
}

export default function NewsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useLocalization();
  const [refreshing, setRefreshing] = useState(false);

  const { data: articles, loading, error, refresh, isStale } = useCachedData({
    key: 'news_1_20',
    fetcher: async () => {
      const response = await apiClient.get<Article[]>('/news');
      if (response.success && response.data) return response.data;
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

  if (loading && !articles?.length) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#db74cf" accessible accessibilityLabel={t('common.loading')} />
      </SafeAreaView>
    );
  }

  if (error && !articles?.length) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={styles.errorText} accessible accessibilityRole="alert">
          {error.message}
        </Text>
        <TouchableOpacity onPress={handleRefresh} style={styles.retryButton} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
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
          <Text style={[styles.staleText, { color: colors.warning }]}>{t('news.showing_cached')}</Text>
        </View>
      )}

      <StandardList
        data={articles ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NewsCard item={item} onPress={() => router.push(`/news/${item.id}`)} colors={colors} />
        )}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        loading={loading}
        itemHeight={NEWS_ITEM_HEIGHT}
        estimatedItemSize={NEWS_ITEM_HEIGHT}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: colors.text }}>{t('news.no_news')}</Text>
          </View>
        }
        error={error ? error.message : null}
        onRetry={handleRefresh}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 12 },
  card: {
    borderRadius: 10,
    marginBottom: CARD_MARGIN_BOTTOM,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: CARD_PADDING_V,
    gap: 12,
  },
  cardText: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  meta: { opacity: 0.6, fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#ff6b6b', marginBottom: 12 },
  retryButton: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#db74cf', borderRadius: 8 },
  retryButtonText: { color: '#ffffff', fontWeight: '600' },
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
  staleText: { fontSize: 12, fontWeight: '500', marginLeft: 6 },
});
