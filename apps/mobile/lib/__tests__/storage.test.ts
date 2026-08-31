import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiGet: jest.fn(),
  multiRemove: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { storage } from '../storage';

describe('storage utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores and retrieves access tokens from secure storage', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('token-123');

    await expect(storage.getAccessToken()).resolves.toBe('token-123');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('auth_token');
  });

  it('stores tokens and clears plaintext migration state', async () => {
    await storage.storeTokens('token-123', 'refresh-456');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'token-123');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('refresh_token', 'refresh-456');
  });

  it('sanitizes wallet metadata and keeps only valid public keys', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({
      linkedAccounts: [{
        id: '1',
        publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        label: 'Primary',
        isActive: true,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }],
      activePublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      updatedAt: '2024-01-01',
      lastConnectedEnvironment: 'testnet',
    }));

    const metadata = await storage.getWalletMetadata();

    expect(metadata.linkedAccounts).toHaveLength(1);
    expect(metadata.activePublicKey).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
  });

  it('clears the active wallet pointer without dropping linked accounts', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(JSON.stringify({
      linkedAccounts: [{
        id: '1',
        publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        label: 'Primary',
        isActive: true,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      }],
      activePublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      updatedAt: '2024-01-01',
      lastConnectedEnvironment: 'mainnet',
    }));

    await storage.clearActiveWalletSession();

    expect(SecureStore.setItemAsync).toHaveBeenCalled();
  });

  it('handles missing wallet metadata without crashing', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

    const metadata = await storage.getWalletMetadata();

    expect(metadata.linkedAccounts).toEqual([]);
    expect(metadata.activePublicKey).toBeNull();
  });
});
