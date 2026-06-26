import AsyncStorage from '@react-native-async-storage/async-storage';
import { Article } from './types/news';

const SAVED_ARTICLES_KEY = 'saved_articles';

export const savedNewsService = {
  async getSavedArticles(): Promise<Article[]> {
    try {
      const saved = await AsyncStorage.getItem(SAVED_ARTICLES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Error getting saved articles:', error);
      return [];
    }
  },

  async saveArticle(article: Article): Promise<void> {
    try {
      const saved = await this.getSavedArticles();
      const exists = saved.find((a) => a.id === article.id);
      if (!exists) {
        const updated = [article, ...saved];
        await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(updated));
      }
    } catch (error) {
      console.error('Error saving article:', error);
    }
  },

  async unsaveArticle(articleId: string): Promise<void> {
    try {
      const saved = await this.getSavedArticles();
      const updated = saved.filter((a) => a.id !== articleId);
      await AsyncStorage.setItem(SAVED_ARTICLES_KEY, JSON.stringify(updated));
    } catch (error) {
      console.error('Error unsaving article:', error);
    }
  },

  async isArticleSaved(articleId: string): Promise<boolean> {
    try {
      const saved = await this.getSavedArticles();
      return saved.some((a) => a.id === articleId);
    } catch {
      return false;
    }
  },
};
