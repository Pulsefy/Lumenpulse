import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';

export type DeepLinkTarget = 'grant-round';

export interface DeepLinkInfo {
  target: DeepLinkTarget;
  rawUrl: string;
  id: string;
}

interface DeepLinkContextType {
  pendingDeepLink: DeepLinkInfo | null;
  clearDeepLink: () => void;
}

const DeepLinkContext = createContext<DeepLinkContextType | null>(null);

const SUPPORTED_PATTERNS = [
  {
    pattern: /^\/grants\/(\d+)$/,
    target: 'grant-round' as DeepLinkTarget,
    idIndex: 1,
  },
];

function parseDeepLink(url: string): DeepLinkInfo | null {
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path ?? parsed.hostname ?? '';

    for (const route of SUPPORTED_PATTERNS) {
      const match = path.match(route.pattern);
      if (match) {
        return {
          target: route.target,
          rawUrl: url,
          id: match[route.idIndex],
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export const DeepLinkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pendingDeepLink, setPendingDeepLink] = useState<DeepLinkInfo | null>(null);

  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      const info = parseDeepLink(url);
      if (info) {
        setPendingDeepLink(info);
      }
    };

    const initUrl = Linking.getInitialURL();
    initUrl.then((url) => {
      if (url) {
        const info = parseDeepLink(url);
        if (info) {
          setPendingDeepLink(info);
        }
      }
    });

    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => subscription.remove();
  }, []);

  const clearDeepLink = useCallback(() => {
    setPendingDeepLink(null);
  }, []);

  return (
    <DeepLinkContext.Provider value={{ pendingDeepLink, clearDeepLink }}>
      {children}
    </DeepLinkContext.Provider>
  );
};

export const useDeepLink = () => {
  const context = useContext(DeepLinkContext);
  if (!context) {
    throw new Error('useDeepLink must be used within a DeepLinkProvider');
  }
  return context;
};
