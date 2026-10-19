"use client";

import { WalletProvider } from "@/contexts/WalletContext";
import { StellarConfigProvider, useStellarConfig } from "@/contexts/StellarConfigContext";
import { ConfigErrorBanner } from "@/components/config-error-banner";
import { ToastProvider, ToastViewport } from "@/components/ui/toast";
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  WalletAdapter,
  WalletError,
  WalletSignOptions,
  WalletSigningResult,
  createWalletAdapterRegistry,
  findWalletAdapter,
  getAvailableWalletAdapters,
} from "@/lib/wallet";
import { WalletPickerDialog } from "@/components/wallet/WalletPickerDialog";

/**
 * Inner wrapper that gates the rest of the app behind a successful config load.
 * Renders a full-page error UI if the Stellar config cannot be fetched.
 */
function ConfigGate({ children }: { children: ReactNode }) {
  const { config, status, error, retry } = useStellarConfig();

  const isTestnet = config?.network === "testnet";
  const isError = status === "error";

  // While loading we let the app render normally — individual components
  // can show their own skeletons. The config is available as soon as it resolves.
  return (
    <>
      {isError && (
        <div
          id="config-error-banner"
          className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-4 bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 backdrop-blur-md"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
            <span className="truncate">Degraded Mode: Unable to load Stellar configuration. Some features may be unavailable.</span>
          </div>
          <button
            onClick={retry}
            className="rounded bg-red-500/20 px-3 py-1 text-xs hover:bg-red-500/30 transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}
      {isTestnet && !isError && (
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
import { WatchlistProvider } from "@/hooks/use-watchlist";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StellarConfigProvider>
      <WalletProvider>
        <StellarProvider>
          <ConfigGate>
            <ThemeProvider>
              <WatchlistProvider>
                <OnboardingProvider>
                  <ToastProvider>
                    {children}
                    <ToastViewport />
                  </ToastProvider>
                </OnboardingProvider>
              </WatchlistProvider>
            </ThemeProvider>
          </ConfigGate>
        </StellarProvider>
      </WalletProvider>
    </StellarConfigProvider>
  );
}

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

export interface WalletOption {
  id: string;
  name: string;
  installUrl?: string;
}

interface StellarWalletState {
  publicKey: string | null;
  lastAddress: string | null;
  status: WalletStatus;
  errorType: WalletErrorType;
  error: string | null;
  /** Id of the adapter backing the current session (e.g. "freighter"). */
  walletId: string | null;
  /** Wallets detected in this browser. */
  availableWallets: WalletOption[];
  /**
   * Connect a wallet. With no id, connects the only installed wallet or
   * shows a picker when several are installed. Non-string arguments (e.g. a
   * click event from `onClick={connect}`) are ignored.
   */
  connect: (walletId?: unknown) => Promise<void>;
  disconnect: () => void;
  resetError: () => void;
  /** Sign a base64 transaction envelope with the connected wallet. */
  signXdr: (xdr: string, options?: WalletSignOptions) => Promise<WalletSigningResult>;
}

const STORAGE_KEY = "lumenpulse_wallet_previously_connected";
const STORAGE_ADDRESS_KEY = "lumenpulse_wallet_last_address";
const STORAGE_ADAPTER_KEY = "lumenpulse_wallet_adapter";
const DEFAULT_ADAPTER_ID = "freighter";

const NO_WALLET_MESSAGE =
  "No Stellar wallet extension found. Install Freighter (freighter.app) or xBull (xbull.app) to connect your Stellar wallet.";

const StellarWalletContext = createContext<StellarWalletState>({
  publicKey: null,
  lastAddress: null,
  status: "disconnected",
  errorType: null,
  error: null,
  walletId: null,
  availableWallets: [],
  connect: async () => {},
  disconnect: () => {},
  resetError: () => {},
  signXdr: async () => ({
    status: "failed",
    error: new WalletError("not_available", "Wallet provider is not mounted."),
  }),
});

export function useStellarWallet() {
  return useContext(StellarWalletContext);
}

function toOption(adapter: WalletAdapter): WalletOption {
  return { id: adapter.id, name: adapter.name, installUrl: adapter.installUrl };
}

export function StellarProvider({
  children,
  adapters: adaptersProp,
}: {
  children: ReactNode;
  /** Injected for tests; defaults to the shared registry. */
  adapters?: WalletAdapter[];
}) {
  const [adapters] = useState<WalletAdapter[]>(() => adaptersProp ?? createWalletAdapterRegistry());
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [lastAddress, setLastAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<WalletErrorType>(null);
  const [walletId, setWalletId] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>([]);
  const [pickerOptions, setPickerOptions] = useState<WalletOption[] | null>(null);
  const pickerResolver = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    async function checkConnection() {
      try {
        const available = await getAvailableWalletAdapters(adapters);
        setAvailableWallets(available.map(toOption));

        const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";
        const storedAddress = localStorage.getItem(STORAGE_ADDRESS_KEY);
        const storedAdapterId = localStorage.getItem(STORAGE_ADAPTER_KEY) ?? DEFAULT_ADAPTER_ID;

        if (storedAddress) setLastAddress(storedAddress);

        const adapter = available.find((a) => a.id === storedAdapterId);
        if (!adapter) {
          if (wasConnected) setStatus("missing_extension");
          return;
        }

        const address = adapter.getConnectedAddress
          ? await adapter.getConnectedAddress()
          : null;
        if (address) {
          setPublicKey(address);
          setLastAddress(address);
          setWalletId(adapter.id);
          setStatus("connected");
          localStorage.setItem(STORAGE_KEY, "true");
          localStorage.setItem(STORAGE_ADDRESS_KEY, address);
          localStorage.setItem(STORAGE_ADAPTER_KEY, adapter.id);
          return;
        }

        if (wasConnected) setStatus("previously_connected");
      } catch {
        // Silently fail
      }
    }

    checkConnection();
  }, [adapters]);

  const connectWith = useCallback(async (adapter: WalletAdapter) => {
    setStatus("connecting");

    const result = await adapter.connect();

    if (result.status === "connected" && result.pubkey) {
      setPublicKey(result.pubkey);
      setLastAddress(result.pubkey);
      setWalletId(adapter.id);
      setStatus("connected");
      setError(null);
      setErrorType(null);
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(STORAGE_ADDRESS_KEY, result.pubkey);
      localStorage.setItem(STORAGE_ADAPTER_KEY, adapter.id);
      return;
    }

    if (result.status === "rejected") {
      setStatus("rejected");
      setErrorType("rejected");
      setError("You declined the connection request. Click below to try again.");
      return;
    }

    if (result.error?.code === "missing_wallet") {
      setStatus("missing_extension");
      setErrorType("missing_extension");
      setError(result.error.message);
      return;
    }

    setError(result.error?.message ?? "Failed to connect wallet");
    setErrorType("unknown");
    setStatus("disconnected");
  }, []);

  const choose = useCallback((options: WalletOption[]) => {
    return new Promise<string | null>((resolve) => {
      pickerResolver.current = resolve;
      setPickerOptions(options);
    });
  }, []);

  const closePicker = useCallback((id: string | null) => {
    setPickerOptions(null);
    pickerResolver.current?.(id);
    pickerResolver.current = null;
  }, []);

  const connect = useCallback(
    async (requestedId?: unknown) => {
      setError(null);
      setErrorType(null);

      // Buttons pass `onClick={connect}` directly, so ignore non-string args.
      const explicit =
        typeof requestedId === "string" ? findWalletAdapter(requestedId, adapters) : undefined;
      if (explicit) {
        await connectWith(explicit);
        return;
      }

      const available = await getAvailableWalletAdapters(adapters);
      setAvailableWallets(available.map(toOption));

      if (available.length === 0) {
        setStatus("missing_extension");
        setErrorType("missing_extension");
        setError(NO_WALLET_MESSAGE);
        return;
      }

      if (available.length === 1) {
        await connectWith(available[0]);
        return;
      }

      const chosenId = await choose(available.map(toOption));
      const chosen = available.find((a) => a.id === chosenId);
      if (chosen) await connectWith(chosen);
    },
    [adapters, choose, connectWith],
  );

  const signXdr = useCallback(
    async (xdr: string, options?: WalletSignOptions): Promise<WalletSigningResult> => {
      const adapter =
        findWalletAdapter(walletId, adapters) ??
        findWalletAdapter(DEFAULT_ADAPTER_ID, adapters);
      if (!adapter) {
        return {
          status: "failed",
          error: new WalletError("not_available", "No wallet is connected."),
        };
      }
      return adapter.signXdr(xdr, { address: publicKey ?? undefined, ...options });
    },
    [adapters, walletId, publicKey],
  );

  const disconnect = useCallback(() => {
    // Clean up wallet-scoped localStorage entries before clearing state
    if (publicKey) {
      localStorage.removeItem(`lumenpulse_watchlist_${publicKey}`);
    }
    localStorage.removeItem("activeWalletId");
    setPublicKey(null);
    setLastAddress(null);
    setWalletId(null);
    setStatus("disconnected");
    setError(null);
    setErrorType(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_ADDRESS_KEY);
    localStorage.removeItem(STORAGE_ADAPTER_KEY);
  }, [publicKey]);

  const resetError = useCallback(() => {
    setError(null);
    setErrorType(null);
    const wasConnected = localStorage.getItem(STORAGE_KEY) === "true";
    setStatus(wasConnected ? "previously_connected" : "disconnected");
  }, []);

  let lastUsedId: string | null = null;
  try {
    lastUsedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_ADAPTER_KEY) : null;
  } catch {
    lastUsedId = null;
  }

  return (
    <StellarWalletContext.Provider
      value={{
        publicKey,
        lastAddress,
        status,
        errorType,
        error,
        walletId,
        availableWallets,
        connect,
        disconnect,
        resetError,
        signXdr,
      }}
    >
      {children}
      <WalletPickerDialog
        open={pickerOptions !== null}
        options={pickerOptions ?? []}
        lastUsedId={lastUsedId}
        onSelect={(id) => closePicker(id)}
        onClose={() => closePicker(null)}
      />
    </StellarWalletContext.Provider>
  );
}
