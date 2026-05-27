import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const WALLET_METADATA_KEY = 'wallet_metadata';
const LEGACY_AUTH_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, 'token', 'user'];

export interface WalletAccountMetadata {
  id: string;
  publicKey: string;
  label?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WalletMetadata {
  linkedAccounts: WalletAccountMetadata[];
  activePublicKey: string | null;
  updatedAt: string;
}

const createEmptyWalletMetadata = (): WalletMetadata => ({
  linkedAccounts: [],
  activePublicKey: null,
  updatedAt: new Date().toISOString(),
});

const sanitizeWalletAccounts = (
  accounts: WalletAccountMetadata[],
): WalletAccountMetadata[] =>
  accounts.map((account) => ({
    id: account.id,
    publicKey: account.publicKey,
    label: account.label ?? null,
    isActive: account.isActive,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }));

const parseWalletMetadata = (rawValue: string | null): WalletMetadata => {
  if (!rawValue) {
    return createEmptyWalletMetadata();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<WalletMetadata>;
    const linkedAccounts = Array.isArray(parsed.linkedAccounts)
      ? sanitizeWalletAccounts(parsed.linkedAccounts as WalletAccountMetadata[])
      : [];
    const activePublicKey =
      typeof parsed.activePublicKey === 'string' ? parsed.activePublicKey : null;

    return {
      linkedAccounts,
      activePublicKey:
        linkedAccounts.length === 0
          ? activePublicKey
          : activePublicKey &&
              linkedAccounts.some((account) => account.publicKey === activePublicKey)
            ? activePublicKey
            : linkedAccounts[0]?.publicKey ?? null,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error parsing wallet metadata:', error);
    return createEmptyWalletMetadata();
  }
};

const persistWalletMetadata = async (metadata: WalletMetadata) => {
  await SecureStore.setItemAsync(WALLET_METADATA_KEY, JSON.stringify(metadata));
};

const clearLegacyPlaintextAuthState = async () => {
  await AsyncStorage.multiRemove(LEGACY_AUTH_KEYS);
};

const migrateLegacyTokens = async (): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> => {
  const legacyEntries = await AsyncStorage.multiGet([
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    'token',
  ]);

  const legacyMap = Object.fromEntries(legacyEntries);
  const accessToken = legacyMap[ACCESS_TOKEN_KEY] ?? legacyMap.token ?? null;
  const refreshToken = legacyMap[REFRESH_TOKEN_KEY] ?? null;

  if (accessToken) {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  }

  if (refreshToken) {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  }

  if (accessToken || refreshToken) {
    await clearLegacyPlaintextAuthState();
  }

  return { accessToken, refreshToken };
};

export const storage = {
  async storeTokens(accessToken: string, refreshToken: string) {
    try {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
        SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
      ]);
      await clearLegacyPlaintextAuthState();
    } catch (error) {
      console.error('Error storing tokens:', error);
      throw error;
    }
  },

  async getAccessToken(): Promise<string | null> {
    try {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (token) {
        return token;
      }

      const migrated = await migrateLegacyTokens();
      return migrated.accessToken;
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (refreshToken) {
        return refreshToken;
      }

      const migrated = await migrateLegacyTokens();
      return migrated.refreshToken;
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  },

  async getWalletMetadata(): Promise<WalletMetadata> {
    try {
      const rawMetadata = await SecureStore.getItemAsync(WALLET_METADATA_KEY);
      return parseWalletMetadata(rawMetadata);
    } catch (error) {
      console.error('Error getting wallet metadata:', error);
      return createEmptyWalletMetadata();
    }
  },

  async getLinkedAccountsMetadata(): Promise<WalletAccountMetadata[]> {
    const metadata = await this.getWalletMetadata();
    return metadata.linkedAccounts;
  },

  async getActiveWalletPublicKey(): Promise<string | null> {
    const metadata = await this.getWalletMetadata();
    return metadata.activePublicKey;
  },

  async storeWalletMetadata(metadata: WalletMetadata) {
    try {
      const linkedAccounts = sanitizeWalletAccounts(metadata.linkedAccounts);
      const activePublicKey =
        linkedAccounts.length === 0
          ? metadata.activePublicKey ?? null
          : metadata.activePublicKey &&
              linkedAccounts.some((account) => account.publicKey === metadata.activePublicKey)
            ? metadata.activePublicKey
            : linkedAccounts[0]?.publicKey ?? null;

      await persistWalletMetadata({
        linkedAccounts,
        activePublicKey,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error storing wallet metadata:', error);
      throw error;
    }
  },

  async storeLinkedAccountsMetadata(accounts: WalletAccountMetadata[]) {
    const existingMetadata = await this.getWalletMetadata();
    const linkedAccounts = sanitizeWalletAccounts(accounts);
    const activePublicKey = linkedAccounts.some(
      (account) => account.publicKey === existingMetadata.activePublicKey,
    )
      ? existingMetadata.activePublicKey
      : linkedAccounts[0]?.publicKey ?? null;

    await this.storeWalletMetadata({
      linkedAccounts,
      activePublicKey,
      updatedAt: new Date().toISOString(),
    });
  },

  async setActiveWalletPublicKey(publicKey: string | null) {
    const existingMetadata = await this.getWalletMetadata();

    await this.storeWalletMetadata({
      ...existingMetadata,
      activePublicKey: publicKey,
      updatedAt: new Date().toISOString(),
    });
  },

  async clearWalletMetadata() {
    try {
      await SecureStore.deleteItemAsync(WALLET_METADATA_KEY);
    } catch (error) {
      console.error('Error clearing wallet metadata:', error);
      throw error;
    }
  },

  async clearAuthState() {
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
        SecureStore.deleteItemAsync(WALLET_METADATA_KEY),
      ]);
      await clearLegacyPlaintextAuthState();
    } catch (error) {
      console.error('Error clearing auth state:', error);
      throw error;
    }
  },

  async removeTokens() {
    await this.clearAuthState();
  },
};
