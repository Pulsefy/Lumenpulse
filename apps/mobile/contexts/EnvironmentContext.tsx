import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppEnvironment,
  EnvironmentConfig,
  environmentConfigs,
  getEnvironmentConfig,
  setActiveEnvironment,
} from '../lib/config';

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
