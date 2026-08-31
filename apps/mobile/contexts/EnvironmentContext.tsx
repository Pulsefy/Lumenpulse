import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppEnvironment,
  EnvironmentConfig,
  environmentConfigs,
  getEnvironmentConfig,
  setActiveEnvironment,
  validateEnvironmentConfig,
} from '../lib/config';
import { CacheManager } from '../lib/cache';

const STORAGE_KEY = '@lumenpulse_environment';

interface EnvironmentContextType {
  environment: AppEnvironment;
  environmentConfig: EnvironmentConfig;
  setEnvironment: (environment: AppEnvironment) => Promise<void>;
  isMainnetConfigured: boolean;
  /**
   * True once the persisted environment has been read from AsyncStorage.
   * Other providers (e.g. wallet session restore) should gate on this to
   * avoid making decisions against the synchronous default value.
   */
  isInitialized: boolean;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

const isMainnetConfigReady = Boolean(
  environmentConfigs.mainnet.apiBaseUrl && environmentConfigs.mainnet.sorobanRpcUrl,
);

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error('useEnvironment must be used within an EnvironmentProvider');
  }
  return context;
}

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironmentState] = useState<AppEnvironment>('testnet');
  const [isInitialized, setIsInitialized] = useState(false);

  // Validate config at app startup (will throw in release builds if misconfigured)
  useEffect(() => {
    try {
      validateEnvironmentConfig();
    } catch (error) {
      console.error('Configuration validation failed:', error);
      // In a real app, you'd want to show an error screen or alert here
      // For now, we log it and let the app continue in development
      if (__DEV__) {
        console.warn('Configuration validation skipped in development mode');
      } else {
        // In production, re-throw to crash the app and alert developer
        throw error;
      }
    }
  }, []);

  useEffect(() => {
    const loadEnvironment = async () => {
      const savedEnvironment = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedEnvironment === 'mainnet' && isMainnetConfigReady) {
        setActiveEnvironment('mainnet');
        setEnvironmentState('mainnet');
      } else {
        setActiveEnvironment('testnet');
        setEnvironmentState('testnet');
      }
      setIsInitialized(true);
    };

    loadEnvironment();
  }, []);

  const setEnvironment = async (nextEnvironment: AppEnvironment) => {
    if (nextEnvironment === environment) {
      return;
    }

    // Clear all cached data when switching environments to prevent
    // showing stale data from the previous network
    const cacheManager = CacheManager.getInstance();
    await cacheManager.clear();

    setActiveEnvironment(nextEnvironment);
    setEnvironmentState(nextEnvironment);
    await AsyncStorage.setItem(STORAGE_KEY, nextEnvironment);
  };

  const value = useMemo(
    () => ({
      environment,
      environmentConfig: getEnvironmentConfig(environment),
      setEnvironment,
      isMainnetConfigured: isMainnetConfigReady,
      isInitialized,
    }),
    [environment, isInitialized],
  );

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
}
