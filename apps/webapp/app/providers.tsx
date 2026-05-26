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

export type WalletId = "freighter" | "braavos" | "argent";

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

interface InstallState {
  freighter: boolean;
  braavos: boolean;
  argent: boolean;
}

interface StellarWalletState {
  publicKey: string | null;
  lastWallet: WalletId | null;
  status: WalletStatus;
  errorType: WalletErrorType;
  error: string | null;
  installState: InstallState;
  wasPreviouslyConnected: boolean;
  connect: (walletId: WalletId) => Promise<void>;
  disconnect: () => void;
  resetError: () => void;
}

const STORAGE_KEY = "lumenpulse_wallet_previously_connected";
const STORAGE_ADDRESS_KEY = "lumenpulse_wallet_last_address";
const STORAGE_WALLET_KEY = "lumenpulse_wallet_last_used";

const StellarWalletContext = createContext<StellarWalletState | undefined>(
  undefined,
);

export function useStellarWallet() {
  const context = useContext(StellarWalletContext);
  if (!context) {
    throw new Error("useStellarWallet must be used inside Providers");
  }
  return context;
}

const initialInstallState: InstallState = {
  freighter: false,
  braavos: false,
  argent: false,
};

function getInstallState(): InstallState {
  if (typeof window === "undefined") return initialInstallState;
  return {
    freighter: "freighter" in window,
    braavos: false,
    argent: false,
  };
}

export function Providers({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [lastWallet, setLastWallet] = useState<WalletId | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<WalletErrorType>(null);
  const [installState, setInstallState] =
    useState<InstallState>(initialInstallState);
  const [wasPreviouslyConnected, setWasPreviouslyConnected] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedLastWallet = localStorage.getItem(
      STORAGE_WALLET_KEY,
    ) as WalletId | null;
    const storedAddress = localStorage.getItem(STORAGE_ADDRESS_KEY);
    const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";

    setInstallState(getInstallState());
    setLastWallet(storedLastWallet);
    setWasPreviouslyConnected(wasConnected);

    if (storedAddress && wasConnected && "freighter" in window) {
      freighterIsConnected()
        .then((result) => {
          if (result.isConnected) {
            return freighterGetAddress();
          }
          return null;
        })
        .then((addressData) => {
          const address = addressData?.address;
          if (address) {
            setPublicKey(address);
            setStatus("connected");
          } else if (wasConnected) {
            setStatus("previously_connected");
          }
        })
        .catch(() => {
          if (wasConnected) setStatus("previously_connected");
        });
      return;
    }

    if (wasConnected) {
      setStatus("previously_connected");
    }
  }, []);

  const connect = useCallback(async (walletId: WalletId) => {
    setError(null);
    setErrorType(null);

    if (walletId !== "freighter") {
      setStatus("missing_extension");
      setErrorType("unknown");
      setError(
        "Only Freighter wallet connection is supported in this deployment.",
      );
      return;
    }

    if (!getInstallState().freighter) {
      setStatus("missing_extension");
      setErrorType("missing_extension");
      setError(
        "Freighter extension not found. Please install it to connect your Stellar wallet.",
      );
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
          setError(
            "You declined the connection request. Click below to try again.",
          );
          return;
        }

        throw new Error(result.error);
      }

      const address = result.address || (result as any).publicKey;
      if (!address) {
        setStatus("missing_extension");
        setErrorType("missing_extension");
        setError(
          "Freighter wallet extension not detected. Please install it from freighter.app",
        );
        return;
      }

      setPublicKey(address);
      setLastWallet(walletId);
      setStatus("connected");
      setError(null);
      setErrorType(null);
      setWasPreviouslyConnected(true);
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(STORAGE_WALLET_KEY, walletId);
      localStorage.setItem(STORAGE_ADDRESS_KEY, address);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      setErrorType("unknown");
      setStatus("disconnected");
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setStatus("disconnected");
    setError(null);
    setErrorType(null);
    setWasPreviouslyConnected(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_WALLET_KEY);
    localStorage.removeItem(STORAGE_ADDRESS_KEY);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
    setErrorType(null);
    const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";
    setStatus(wasConnected ? "previously_connected" : "disconnected");
  }, []);

  return (
    <StellarWalletContext.Provider
      value={{
        publicKey,
        lastWallet,
        status,
        errorType,
        error,
        installState,
        wasPreviouslyConnected,
        connect,
        disconnect,
        resetError,
      }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
}
