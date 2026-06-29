"use client";

import { WalletProvider } from "@/contexts/WalletContext";
import { StellarConfigProvider, useStellarConfig } from "@/contexts/StellarConfigContext";
import { ConfigErrorBanner } from "@/components/config-error-banner";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Inner wrapper that gates the rest of the app behind a successful config load.
 * Renders a full-page error UI if the Stellar config cannot be fetched.
 */
function ConfigGate({ children }: { children: ReactNode }) {
  const { config, status, error, retry } = useStellarConfig();

  if (status === "error") {
    return (
      <ConfigErrorBanner
        error={error}
        onRetry={retry}
        isRetrying={false}
      />
    );
  }

  const isTestnet = config?.network === "testnet";

  // While loading we let the app render normally — individual components
  // can show their own skeletons. The config is available as soon as it resolves.
  return (
    <>
      {isTestnet && (
        <div
          id="testnet-banner"
          className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-2 bg-amber-500/10 border-b border-amber-500/30 py-1.5 text-xs font-medium text-amber-400 backdrop-blur-sm"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          You are on Stellar Testnet — assets have no real value
        </div>
      )}
      {children}
    </>
  );
}

import { OnboardingProvider } from "@/lib/onboarding";
import { ThemeProvider } from "@/components/theme-provider";
import { WatchlistProvider } from "@/contexts/WatchlistContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StellarConfigProvider>
      <WalletProvider>
        <StellarProvider>
          <ConfigGate>
            <ThemeProvider>
              <WatchlistProvider>
                <OnboardingProvider>
                  {children}
                </OnboardingProvider>
              </WatchlistProvider>
            </ThemeProvider>
          </ConfigGate>
        </StellarProvider>
      </WalletProvider>
    </StellarConfigProvider>
  );
}

import {
  isConnected as freighterIsConnected,
  getAddress as freighterGetAddress,
  requestAccess,
} from "@stellar/freighter-api";

export type WalletStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "rejected"
  | "missing_extension"
  | "previously_connected";

export type WalletErrorType =
  | "missing_extension"
  | "rejected"
  | "unknown"
  | null;

interface StellarWalletState {
  publicKey: string | null;
  lastAddress: string | null;
  status: WalletStatus;
  errorType: WalletErrorType;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  resetError: () => void;
}

const STORAGE_KEY = "lumenpulse_wallet_previously_connected";
const STORAGE_ADDRESS_KEY = "lumenpulse_wallet_last_address";

const StellarWalletContext = createContext<StellarWalletState>({
  publicKey: null,
  lastAddress: null,
  status: "disconnected",
  errorType: null,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  resetError: () => {},
});

export function useStellarWallet() {
  return useContext(StellarWalletContext);
}

export function StellarProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [lastAddress, setLastAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<WalletErrorType>(null);

  const checkFreighterInstalled = (): boolean => {
    return typeof window !== "undefined" && "freighter" in window;
  };

  useEffect(() => {
    async function checkConnection() {
      try {
        const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";
        const storedAddress = localStorage.getItem(STORAGE_ADDRESS_KEY);
        const installed = checkFreighterInstalled();

        if (storedAddress) setLastAddress(storedAddress);

        if (!installed) {
          if (wasConnected) setStatus("missing_extension");
          return;
        }

        const { isConnected } = await freighterIsConnected();
        if (isConnected) {
          const { address } = await freighterGetAddress();
          if (address) {
            setPublicKey(address);
            setLastAddress(address);
            setStatus("connected");
            localStorage.setItem(STORAGE_KEY, "true");
            localStorage.setItem(STORAGE_ADDRESS_KEY, address);
            return;
          }
        }

        if (wasConnected) setStatus("previously_connected");
      } catch {
        // Silently fail
      }
    }

    checkConnection();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setErrorType(null);

    if (!checkFreighterInstalled()) {
      setStatus("missing_extension");
      setErrorType("missing_extension");
      setError("Freighter extension not found. Please install it to connect your Stellar wallet.");
      return;
    }

    setStatus("connecting");

    try {
      const result = await requestAccess();

      if (result.error) {
        const errLower = result.error.toLowerCase();
        const isRejection =
          errLower.includes("user") ||
          errLower.includes("denied") ||
          errLower.includes("reject") ||
          errLower.includes("cancelled") ||
          errLower.includes("canceled");

        if (isRejection) {
          setStatus("rejected");
          setErrorType("rejected");
          setError("You declined the connection request. Click below to try again.");
          return;
        }

        throw new Error(result.error);
      }

      if (!result.address) {
        setStatus("missing_extension");
        setErrorType("missing_extension");
        setError("Freighter wallet extension not detected. Please install it from freighter.app");
        return;
      }

      setPublicKey(result.address);
      setLastAddress(result.address);
      setStatus("connected");
      setError(null);
      setErrorType(null);
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(STORAGE_ADDRESS_KEY, result.address);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      setErrorType("unknown");
      setStatus("disconnected");
    }
  }, []);

  const disconnect = useCallback(() => {
    // Clean up wallet-scoped localStorage entries before clearing state
    if (publicKey) {
      localStorage.removeItem(`lumenpulse_watchlist_${publicKey}`);
    }
    localStorage.removeItem("activeWalletId");
    setPublicKey(null);
    setLastAddress(null);
    setStatus("disconnected");
    setError(null);
    setErrorType(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_ADDRESS_KEY);
  }, [publicKey]);

  const resetError = useCallback(() => {
    setError(null);
    setErrorType(null);
    const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";
    setStatus(wasConnected ? "previously_connected" : "disconnected");
  }, []);

  return (
    <StellarWalletContext.Provider
      value={{ publicKey, lastAddress, status, errorType, error, connect, disconnect, resetError }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
}
