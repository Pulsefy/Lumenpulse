import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const CACHED_ACCOUNTS_KEY = 'cached_linked_accounts';
const CACHED_PORTFOLIO_KEY = 'cached_portfolio_summary';
const CACHED_TRANSACTIONS_KEY = 'cached_transactions';

export const storage = {
  // Store auth tokens
  async storeTokens(accessToken: string, refreshToken: string) {
    try {
      await AsyncStorage.setItem(TOKEN_KEY, accessToken);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } catch (error) {
      console.error('Error storing tokens:', error);
      throw error;
    }
  },

  // Get access token
  async getAccessToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  },

  // Get refresh token
  async getRefreshToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  },

  // Remove tokens (logout)
  async removeTokens() {
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch (error) {
      console.error('Error removing tokens:', error);
      throw error;
    }
  },

  // Clear all session data including wallet cache
  async clearAll() {
    try {
      const keys = [
        TOKEN_KEY,
        REFRESH_TOKEN_KEY,
        CACHED_ACCOUNTS_KEY,
        CACHED_PORTFOLIO_KEY,
        CACHED_TRANSACTIONS_KEY,
      ];
      await AsyncStorage.multiRemove(keys);
    } catch (error) {
      console.error('Error clearing session data:', error);
      throw error;
    }
  },

  // Cache linked accounts (wallet-specific state)
  async cacheLinkedAccounts(accounts: unknown) {
    try {
      await AsyncStorage.setItem(CACHED_ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch (error) {
      console.error('Error caching linked accounts:', error);
    }
  },

  // Get cached linked accounts
  async getCachedLinkedAccounts<T>(): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHED_ACCOUNTS_KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      console.error('Error reading cached linked accounts:', error);
      return null;
    }
  },
};