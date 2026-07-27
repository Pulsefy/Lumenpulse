import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const WALLET_METADATA_KEY = 'wallet_metadata';
const LEGACY_AUTH_KEYS = [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, 'token', 'user'];

export type WalletNetworkTag = 'testnet' | 'mainnet';

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
  /**
   * The Stellar network (`testnet` | `mainnet`) that the active wallet
   * session was last connected against. Used at app launch to detect when a
   * saved wallet belongs to a now-unsupported network. Optional so that
   * pre-existing metadata written by earlier app versions keeps parsing.
   */
  lastConnectedEnvironment?: WalletNetworkTag | null;
}

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

const isValidPublicKey = (value: unknown): value is string =>
  typeof value === 'string' && STELLAR_PUBLIC_KEY_REGEX.test(value);

const isValidNetworkTag = (value: unknown): value is WalletNetworkTag =>
  value === 'testnet' || value === 'mainnet';

export const sanitizePublicKey = (value: unknown): string | null =>
  isValidPublicKey(value) ? value : null;

const createEmptyWalletMetadata = (): WalletMetadata => ({
  linkedAccounts: [],
  activePublicKey: null,
  updatedAt: new Date().toISOString(),
  lastConnectedEnvironment: null,
});

const sanitizeWalletAccounts = (accounts: WalletAccountMetadata[]): WalletAccountMetadata[] =>
  accounts
    .filter((account) => isValidPublicKey(account?.publicKey))
    .map((account) => ({
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

    const rawActivePublicKey = parsed.activePublicKey;
    const activePublicKey =
      typeof rawActivePublicKey === 'string' && isValidPublicKey(rawActivePublicKey)
        ? rawActivePublicKey
        : null;

    return {
      linkedAccounts,
      activePublicKey:
        linkedAccounts.length === 0
          ? activePublicKey
          : activePublicKey &&
              linkedAccounts.some((account) => account.publicKey === activePublicKey)
            ? activePublicKey
            : (linkedAccounts[0]?.publicKey ?? null),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      lastConnectedEnvironment: isValidNetworkTag(parsed.lastConnectedEnvironment)
        ? parsed.lastConnectedEnvironment
        : null,
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
  const legacyEntries = await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, 'token']);

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
      // If metadata is unreadable, treat as empty so callers don't get false
      // confidence that a wallet is connected.
      await this.clearWalletMetadata();
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

  /**
   * Returns the network tag associated with the currently active wallet
   * session. May be `null` for legacy/never-tagged sessions, which callers
   * should treat as "needs reconnection on a known network".
   */
  async getActiveWalletNetworkTag(): Promise<WalletNetworkTag | null> {
    const metadata = await this.getWalletMetadata();
    return isValidNetworkTag(metadata.lastConnectedEnvironment)
      ? metadata.lastConnectedEnvironment
      : null;
  },

  async storeWalletMetadata(metadata: WalletMetadata) {
    try {
      const linkedAccounts = sanitizeWalletAccounts(metadata.linkedAccounts);
      const activePublicKey =
        linkedAccounts.length === 0
          ? (metadata.activePublicKey ?? null)
          : isValidPublicKey(metadata.activePublicKey) &&
              linkedAccounts.some((account) => account.publicKey === metadata.activePublicKey)
            ? metadata.activePublicKey
            : (linkedAccounts[0]?.publicKey ?? null);

      await persistWalletMetadata({
        linkedAccounts,
        activePublicKey,
        updatedAt: new Date().toISOString(),
        lastConnectedEnvironment: isValidNetworkTag(metadata.lastConnectedEnvironment)
          ? metadata.lastConnectedEnvironment
          : null,
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
      : (linkedAccounts[0]?.publicKey ?? null);

    await this.storeWalletMetadata({
      linkedAccounts,
      activePublicKey,
      updatedAt: new Date().toISOString(),
      lastConnectedEnvironment: existingMetadata.lastConnectedEnvironment ?? null,
    });
  },

  /**
   * Updates the active wallet. When `networkTag` is provided, the wallet
   * session is tagged with the network it was authorized against so that a
   * later launch on a different network can detect the mismatch and recover.
   */
  async setActiveWalletPublicKey(
    publicKey: string | null,
    networkTag: WalletNetworkTag | null = null,
  ) {
    const existingMetadata = await this.getWalletMetadata();
    const sanitizedPublicKey = sanitizePublicKey(publicKey);

    await this.storeWalletMetadata({
      ...existingMetadata,
      activePublicKey: sanitizedPublicKey,
      lastConnectedEnvironment: networkTag,
      updatedAt: new Date().toISOString(),
    });
  },

  /**
   * Clears only the active wallet pointer and the network tag. Linked
   * accounts remain so the user doesn't have to re-link after a network
   * switch. Use {@link clearWalletMetadata} when a full wipe is required.
   */
  async clearActiveWalletSession() {
    const existingMetadata = await this.getWalletMetadata();
    await this.storeWalletMetadata({
      ...existingMetadata,
      activePublicKey: null,
      lastConnectedEnvironment: null,
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
