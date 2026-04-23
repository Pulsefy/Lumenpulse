"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  isConnected as freighterIsConnected,
  getAddress as freighterGetAddress,
  requestAccess,
} from "@stellar/freighter-api";
import { OnboardingProvider as OnboardingP } from "@/lib/onboarding";
import { ThemeProvider } from "@/components/theme-provider";

interface StellarWalletState {
  publicKey: string | null;
  status: "disconnected" | "connecting" | "connected";
  connect: () => Promise<void>;
  disconnect: () => void;
  error: string | null;
}

const StellarWalletContext = createContext<StellarWalletState>({
  publicKey: null,
  status: "disconnected",
  connect: async () => {},
  disconnect: () => {},
  error: null,
});

export function useStellarWallet() {
  return useContext(StellarWalletContext);
}

export { OnboardingP as OnboardingProvider };

export function StellarProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [error, setError] = useState<string | null>(null);

  // Check if Freighter is already connected on mount
  useEffect(() => {
    async function checkConnection() {
      try {
        const { isConnected } = await freighterIsConnected();
        if (isConnected) {
          const { address } = await freighterGetAddress();
          if (address) {
            setPublicKey(address);
            setStatus("connected");
          }
        }
      } catch {
        // Silently fail - user just hasn't connected yet
      }
    }
    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setStatus("connecting");

    try {
      const result = await requestAccess();

      if (result.error) {
        if (
          result.error.includes("user") ||
          result.error.includes("denied") ||
          result.error.includes("reject")
        ) {
          throw new Error(
            "Connection was rejected or no account is available."
          );
        }
        throw new Error(result.error);
      }

      if (!result.address) {
        throw new Error(
          "Freighter wallet extension not detected. Please install it from freighter.app"
        );
      }

      setPublicKey(result.address);
      setStatus("connected");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      setStatus("disconnected");
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  return (
    <StellarWalletContext.Provider
      value={{ publicKey, status, connect, disconnect, error }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
}

/**
 * Root Providers component that wraps the application with all necessary providers
 * 
 * This component combines:
 * - ThemeProvider: Manages theme state, persistence, and system detection
 * - StellarProvider: Manages Stellar wallet connection state
 * 
 * Requirements: 3.3, 3.1
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      defaultTheme="system"
      storageKey="lumenpulse-theme-preference"
      enableTransitions={true}
    >
      <OnboardingP>
        <StellarProvider>
          {children}
        </StellarProvider>
      </OnboardingP>
    </ThemeProvider>
  );
}
