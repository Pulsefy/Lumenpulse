import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useLocalization } from '@/src/context';
import { Article } from '@/lib/types/news';
import { savedNewsService } from '@/lib/saved-news';

export default function SavedNewsScreen() {
  const [articles, setArticles] = useState<Article[]>([]);
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useLocalization();

  useEffect(() => {
    loadSavedArticles();
  }, []);

  const loadSavedArticles = async () => {
    const saved = await savedNewsService.getSavedArticles();
    setArticles(saved);
  };

  const renderItem = ({ item }: { item: Article }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/news/${item.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`${item.title}. ${item.source}. ${new Date(item.publishedAt).toLocaleString()}`}
      accessibilityHint="Double tap to read article"
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.title, { color: colors.text }]} accessible accessibilityRole="header">
          {item.title}
        </Text>
        <TouchableOpacity
          onPress={async (e) => {
            e.stopPropagation();
            await savedNewsService.unsaveArticle(item.id);
            loadSavedArticles();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('news.saved')}
        >
          <Ionicons name="bookmark" size={20} color="#db74cf" />
        </TouchableOpacity>
      </View>
      <Text style={[styles.meta, { color: colors.text }]} accessible>
        {item.source} • {new Date(item.publishedAt).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: t('news.saved') }} />
      {articles.length === 0 ? (
        <View style={styles.emptyContainer} accessible accessibilityLabel="No saved news">
          <Ionicons name="bookmark-outline" size={64} color={colors.text} style={{ opacity: 0.2 }} accessible />
          <Text style={[styles.emptyText, { color: colors.text }]} accessible>
            {t('news.no_news')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          accessibilityLabel={t('news.saved')}
          accessibilityRole="list"
        />
      )}
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  meta: {
    opacity: 0.6,
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.6,
  },
});
