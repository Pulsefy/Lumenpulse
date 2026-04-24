import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, View } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/contexts/ThemeContext';
import { Article } from '@/lib/types/news';
import { savedNewsService } from '@/lib/saved-news';

export default function SavedNewsScreen() {
  const [articles, setArticles] = useState<Article[]>([]);
  const router = useRouter();
  const { colors } = useTheme();

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
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
        <TouchableOpacity
          onPress={async (e) => {
            e.stopPropagation();
            await savedNewsService.unsaveArticle(item.id);
            loadSavedArticles();
          }}
        >
          <Ionicons name="bookmark" size={20} color="#db74cf" />
        </TouchableOpacity>
      </View>
      <Text style={[styles.meta, { color: colors.text }]}>
        {item.source} • {new Date(item.publishedAt).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Saved News' }} />
      {articles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name="bookmark-outline"
            size={64}
            color={colors.text}
            style={{ opacity: 0.2 }}
          />
          <Text style={[styles.emptyText, { color: colors.text }]}>No saved articles yet.</Text>
        </View>
      ) : (
        <FlatList
          data={articles}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
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
