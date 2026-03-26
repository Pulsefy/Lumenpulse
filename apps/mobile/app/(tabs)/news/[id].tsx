import React, { useEffect, useState } from 'react';
import {
  Text,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { apiClient } from '../../../lib/api-client';
import { useTheme } from '../../../contexts/ThemeContext';

interface Article {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  description?: string;
  content?: string;
}

export default function ArticleDetail() {
  const { id } = useLocalSearchParams();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { colors } = useTheme();

  useEffect(() => {
    fetchArticle();
  }, []);

  const fetchArticle = async () => {
    setLoading(true);
    setError(null);
    const response = await apiClient.get<Article>(`/news/${id}`);
    if (response.success && response.data) {
      setArticle(response.data);
    } else {
      setError(response.error?.message || 'Article not found.');
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#db74cf" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity onPress={fetchArticle} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={[styles.title, { color: colors.text }]}>{article?.title}</Text>
        <Text style={[styles.meta, { color: colors.text }]}>
          {article?.source} • {new Date(article?.publishedAt ?? '').toLocaleString()}
        </Text>
        <Text style={[styles.content, { color: colors.text }]}>
          {article?.description || article?.content}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  meta: {
    opacity: 0.6,
    marginBottom: 16,
  },
  content: {
    fontSize: 16,
    lineHeight: 22,
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
});