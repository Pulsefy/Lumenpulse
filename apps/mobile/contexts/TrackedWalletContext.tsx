import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LinkedStellarAccount, portfolioApi, usersApi } from '../lib/api';
import { resolveActiveAccount } from '../lib/wallet-account';
import { storage } from '../lib/storage';
import { useAuth } from './AuthContext';

export interface TrackedWalletContextType {
  linkedAccounts: LinkedStellarAccount[];
  activeAccount: LinkedStellarAccount | null;
  activePublicKey: string | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
  refreshAccounts: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<boolean>;
}

const TrackedWalletContext = createContext<TrackedWalletContextType | null>(null);

export const TrackedWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedStellarAccount[]>([]);
  const [activePublicKey, setActivePublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeAccount = useMemo(
    () => resolveActiveAccount(linkedAccounts, activePublicKey),
    [linkedAccounts, activePublicKey],
  );

  const refreshAccounts = useCallback(async () => {
    if (!isAuthenticated) {
      setLinkedAccounts([]);
      setActivePublicKey(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [cachedAccounts, storedActiveKey, profileResponse, accountsResponse] =
        await Promise.all([
          storage.getLinkedAccountsMetadata(),
          storage.getActiveWalletPublicKey(),
          usersApi.getProfile(),
          usersApi.getLinkedAccounts(),
        ]);

      if (cachedAccounts.length > 0) {
        setLinkedAccounts(cachedAccounts);
        setActivePublicKey(storedActiveKey);
      }

      if (!accountsResponse.success) {
        throw new Error(accountsResponse.error?.message ?? 'Failed to load linked accounts.');
      }

      const accounts = accountsResponse.data ?? [];
      setLinkedAccounts(accounts);
      await storage.storeLinkedAccountsMetadata(accounts);

      const profileKey = profileResponse.success
        ? (profileResponse.data?.stellarPublicKey ?? null)
        : null;
      const resolvedKey =
        storedActiveKey && accounts.some((account) => account.publicKey === storedActiveKey)
          ? storedActiveKey
          : profileKey && accounts.some((account) => account.publicKey === profileKey)
            ? profileKey
            : (resolveActiveAccount(accounts, null)?.publicKey ?? null);

      setActivePublicKey(resolvedKey);
      if (resolvedKey) {
        await storage.setActiveWalletPublicKey(resolvedKey);
      }
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : 'Failed to load wallet accounts.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const switchAccount = useCallback(
    async (accountId: string): Promise<boolean> => {
      const target = linkedAccounts.find((account) => account.id === accountId);
      if (!target) {
        return false;
      }

      if (activeAccount?.id === accountId) {
        return true;
      }

      setIsSwitching(true);
      setError(null);

      try {
        const response = await usersApi.setPrimaryAccount(accountId);
        if (!response.success) {
          throw new Error(response.error?.message ?? 'Could not switch to the selected wallet.');
        }

        setActivePublicKey(target.publicKey);
        await storage.setActiveWalletPublicKey(target.publicKey);

        try {
          await portfolioApi.createSnapshot();
        } catch {
          // Snapshot refresh is best-effort; summary fetch still returns latest stored data.
        }

        await refreshAccounts();
        return true;
      } catch (switchError) {
        const message =
          switchError instanceof Error
            ? switchError.message
            : 'Could not switch to the selected wallet.';
        setError(message);
        return false;
      } finally {
        setIsSwitching(false);
      }
    },
    [activeAccount?.id, linkedAccounts, refreshAccounts],
  );

  useEffect(() => {
    if (isAuthenticated) {
      void refreshAccounts();
      return;
    }

    setLinkedAccounts([]);
    setActivePublicKey(null);
    setError(null);
  }, [isAuthenticated, refreshAccounts]);

  const value = useMemo(
    () => ({
      linkedAccounts,
      activeAccount,
      activePublicKey: activeAccount?.publicKey ?? null,
      isLoading,
      isSwitching,
      error,
      refreshAccounts,
      switchAccount,
    }),
    [linkedAccounts, activeAccount, isLoading, isSwitching, error, refreshAccounts, switchAccount],
  );

  return <TrackedWalletContext.Provider value={value}>{children}</TrackedWalletContext.Provider>;
};

export const useTrackedWallet = () => {
  const context = useContext(TrackedWalletContext);
  if (!context) {
    throw new Error('useTrackedWallet must be used within a TrackedWalletProvider');
  }
  return context;
};
