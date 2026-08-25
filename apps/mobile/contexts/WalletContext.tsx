import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { useLocalization } from '../src/context';
import { useEnvironment } from './EnvironmentContext';
import { storage, WalletNetworkTag, sanitizePublicKey } from '../lib/storage';
import { WalletError } from '../lib/wallet/errors';
import { getDefaultWalletAdapter } from '../lib/wallet/registry';
import { WalletAdapter, WalletSigningResult, WalletSigningState } from '../lib/wallet/types';

export type WalletStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'reconnecting'
  | 'network_mismatch'
  | 'restore_failed';

/**
 * Outcome returned from session restore so callers (and tests) can verify
 * the path the provider took without introspecting internal state.
 */
export type WalletRestoreOutcome =
  | 'no_session'
  | 'restored'
  | 'invalidated_network'
  | 'invalidated_format'
  | 'read_failed'
  | 'linked';

interface WalletContextType {
  publicKey: string | null;
  status: WalletStatus;
  /** Last network the connected wallet session was authorized against. */
  lastConnectedNetwork: WalletNetworkTag | null;
  /** True while a session restore pass is in flight. */
  isRestoring: boolean;
  /** Outcome of the most recent restore attempt, if any. */
  lastRestoreOutcome: WalletRestoreOutcome | null;
  /** Independent signing lifecycle state. */
  signingState: WalletSigningState;
  /** Error from the most recent signing attempt, if any. */
  lastSigningError: WalletError | null;
  /** Connect a wallet for the first time on the active network. */
  connect: () => Promise<void>;
  /**
   * Reconnect an existing wallet session after a network change (or a
   * previously cleared session). Uses the same dialog as connect(), but the
   * UI observations distinguish between reconnect and first-time connect.
   */
  reconnect: () => Promise<void>;
  /**
   * Adopt a Stellar public key as the current wallet session when it has
   * been linked to the contribution profile via QR scan or backend
   * confirmation. Keeps storage and provider state in sync so screens that
   * read useWallet() reflect the newly-linked account immediately.
   * Invalid-format keys are silently rejected and the previous state is
   * retained.
   */
  adoptLinkedAccount: (publicKey: string, network?: WalletNetworkTag) => Promise<void>;
  /** Disconnect the active wallet and clear the stored session pointer. */
  disconnect: () => void;
  /** Sign a base64 Stellar transaction envelope using the active wallet adapter. */
  signAndSubmitXdr: (xdr: string) => Promise<WalletSigningResult>;
}

const WalletContext = createContext<WalletContextType | null>(null);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [lastConnectedNetwork, setLastConnectedNetwork] = useState<WalletNetworkTag | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [lastRestoreOutcome, setLastRestoreOutcome] = useState<WalletRestoreOutcome | null>(null);
  const [signingState, setSigningState] = useState<WalletSigningState>('idle');
  const [lastSigningError, setLastSigningError] = useState<WalletError | null>(null);
  const { t } = useLocalization();
  const { environment, isInitialized: isEnvironmentReady } = useEnvironment();
  // Tracks whether a restore attempt has completed at least once so we
  // don't re-clear a freshly connected session when the environment
  // re-resolves during normal app use.
  const hasRestoredRef = useRef(false);
  const activeAdapterRef = useRef<WalletAdapter | null>(null);
  const pendingSignRef = useRef<Deferred<WalletSigningResult> | null>(null);

  // ------- Restore on launch ---------------------------------------------
  useEffect(() => {
    if (!isEnvironmentReady) {
      // Wait for environment to be loaded so we don't make decisions
      // against the synchronous 'testnet' default.
      return;
    }

    let cancelled = false;
    const restoreSession = async () => {
      setIsRestoring(true);
      try {
        const metadata = await storage.getWalletMetadata();
        const sanitizedActive = sanitizePublicKey(metadata.activePublicKey);

        if (!sanitizedActive) {
          // No prior session, or saved session was corrupted: nothing to do.
          if (!cancelled) {
            setPublicKey(null);
            setLastConnectedNetwork(null);
            setStatus('disconnected');
            setLastRestoreOutcome('no_session');
          }
          return;
        }

        const tag = metadata.lastConnectedEnvironment;

        if (tag && tag !== environment) {
          // Stale network: silently clear the active wallet pointer and
          // remember which network the user was last on so the UI can
          // prompt for a reconnect.
          await storage.clearActiveWalletSession();
          if (!cancelled) {
            setPublicKey(null);
            setLastConnectedNetwork(tag);
            setStatus('network_mismatch');
            setLastRestoreOutcome('invalidated_network');
          }
          return;
        }

        // Valid restore: public key present, format-valid, network matches.
        if (!cancelled) {
          setPublicKey(sanitizedActive);
          setLastConnectedNetwork(tag ?? environment);
          setStatus('connected');
          setLastRestoreOutcome('restored');
        }
      } catch (error) {
        console.error('Wallet restore failed:', error);
        // Fail safe: surface a recoverable state and clear any stale data.
        try {
          await storage.clearActiveWalletSession();
        } catch (cleanupError) {
          console.error('Failed to clear stale wallet state during recovery:', cleanupError);
        }
        if (!cancelled) {
          setPublicKey(null);
          setLastConnectedNetwork(null);
          setStatus('restore_failed');
          setLastRestoreOutcome('read_failed');
        }
      } finally {
        if (!cancelled) {
          setIsRestoring(false);
          hasRestoredRef.current = true;
        }
      }
    };

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [environment, isEnvironmentReady]);

  // ------- React to environment changes after restore ---------------------
  // After a successful restore, we still want to invalidate the session if
  // the user explicitly switches the network (testnet <-> mainnet).
  useEffect(() => {
    if (!isEnvironmentReady || !hasRestoredRef.current) return;
    if (status !== 'connected') return;
    if (lastConnectedNetwork === environment) return;

    void (async () => {
      try {
        await storage.clearActiveWalletSession();
      } catch (error) {
        console.error('Failed to clear wallet session on environment change:', error);
      }
      setPublicKey(null);
      setStatus('network_mismatch');
    })();
  }, [environment, isEnvironmentReady, status, lastConnectedNetwork]);

  // ------- Deep link handler ---------------------------------------------
  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      try {
        const parsedUrl = Linking.parse(url);

        if (parsedUrl.path === 'wallet-callback') {
          const { status: cbStatus, tx_hash: txHash, pubkey } = parsedUrl.queryParams || {};

          // If a signing flow is pending, the callback belongs to it.
          if (pendingSignRef.current) {
            const deferred = pendingSignRef.current;
            pendingSignRef.current = null;

            if (cbStatus === 'success' && typeof txHash === 'string' && txHash.length > 0) {
              setSigningState('success');
              deferred.resolve({ status: 'success', txHash });
            } else if (cbStatus === 'rejected') {
              setSigningState('rejected');
              deferred.resolve({ status: 'rejected' });
            } else {
              const err = new WalletError(
                'unknown',
                cbStatus === 'failed'
                  ? t('wallet.sign.error_failed')
                  : t('wallet.sign.error_unknown'),
              );
              setSigningState('failed');
              setLastSigningError(err);
              deferred.resolve({ status: 'failed', error: err });
            }
            return;
          }

          // Otherwise this is a connection callback.
          if (status === 'connecting' || status === 'reconnecting') {
            if (pubkey) {
              const cleanKey = sanitizePublicKey(pubkey);
              setPublicKey(cleanKey);
              setStatus('connected');
              setLastConnectedNetwork(environment);
              if (cleanKey) {
                void storage.setActiveWalletPublicKey(cleanKey, environment);
              }
            } else if (cbStatus === 'rejected') {
              setStatus('rejected');
            }
          }
        }
      } catch (e) {
        console.error('Deep link error', e);
      }
    };

    const initUrl = Linking.getInitialURL();
    initUrl.then((url) => {
      if (url) handleDeepLink({ url });
    });

    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
    // status & publicKey & environment are captured by the closure but we
    // intentionally only re-register the listener on the deep-link API
    // so the same handler is reused across changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalizeConnection = useCallback(
    async (key: string | null) => {
      const sanitized = sanitizePublicKey(key);
      setPublicKey(sanitized);
      setLastConnectedNetwork(environment);
      setStatus('connected');
      if (sanitized) {
        await storage.setActiveWalletPublicKey(sanitized, environment);
      }
    },
    [environment],
  );

  const ensureAdapter = useCallback(async () => {
    if (!activeAdapterRef.current) {
      activeAdapterRef.current = await getDefaultWalletAdapter();
    }
    return activeAdapterRef.current;
  }, []);

  const promptAdapterAction = useCallback(
    (intent: 'connect' | 'reconnect', action: () => Promise<void>): Promise<void> => {
      const title =
        intent === 'reconnect' ? t('wallet.reconnect.title') : t('wallet.connect.title');
      const message =
        intent === 'reconnect'
          ? t('wallet.reconnect.message', { network: environment })
          : t('wallet.connect.message', { network: environment });

      return new Promise<void>((resolve) => {
        Alert.alert(title, message, [
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: () => {
              setStatus((prev) =>
                intent === 'reconnect' && prev === 'network_mismatch'
                  ? 'network_mismatch'
                  : 'disconnected',
              );
              resolve();
            },
          },
          {
            text: t('wallet.connect.continue_button'),
            onPress: () => {
              void (async () => {
                try {
                  await action();
                } catch (error) {
                  console.error(`${intent} action failed:`, error);
                  setStatus('rejected');
                } finally {
                  resolve();
                }
              })();
            },
          },
        ]);
      });
    },
    [environment, t],
  );

  const performConnect = useCallback(
    async (intent: 'connect' | 'reconnect') => {
      const adapter = await ensureAdapter();
      const result = await adapter.connect();

      if (result.status === 'connected' && result.pubkey) {
        await finalizeConnection(result.pubkey);
      } else if (result.status === 'connected') {
        // Deep-link flow: the wallet app will call back with the public key.
      } else {
        const err = result.error ?? new WalletError('unknown', t('wallet.connect.error_message'));
        setStatus('rejected');
        Alert.alert(t('wallet.connect.error_title'), t(`wallet.error.${err.code}`));
      }
    },
    [ensureAdapter, finalizeConnection, t],
  );

  const connect = useCallback(async () => {
    setStatus('connecting');
    await promptAdapterAction('connect', () => performConnect('connect'));
  }, [performConnect, promptAdapterAction]);

  const reconnect = useCallback(async () => {
    setStatus('reconnecting');
    await promptAdapterAction('reconnect', () => performConnect('reconnect'));
  }, [performConnect, promptAdapterAction]);

  const adoptLinkedAccount = useCallback(
    async (publicKey: string, network: WalletNetworkTag | null = null): Promise<void> => {
      const cleanKey = sanitizePublicKey(publicKey);
      if (!cleanKey) {
        // Silently retain the previous session rather than risk overwriting a
        // valid connected wallet with an invalid pointer.
        return;
      }
      const tag = network ?? environment;
      setPublicKey(cleanKey);
      setLastConnectedNetwork(tag);
      setStatus('connected');
      try {
        await storage.setActiveWalletPublicKey(cleanKey, tag);
      } catch (error) {
        console.error('Failed to persist linked wallet session:', error);
      }
    },
    [environment],
  );

  const disconnect = useCallback(async () => {
    setPublicKey(null);
    setLastConnectedNetwork(null);
    setStatus('disconnected');
    setLastRestoreOutcome('no_session');
    setSigningState('idle');
    setLastSigningError(null);
    try {
      await storage.clearActiveWalletSession();
    } catch (error) {
      console.error('Error clearing wallet session during disconnect:', error);
    }
  }, []);

  const signAndSubmitXdr = useCallback(
    async (xdr: string): Promise<WalletSigningResult> => {
      if (signingState === 'signing' || signingState === 'pending') {
        return {
          status: 'failed',
          error: new WalletError('not_available', t('wallet.sign.error_concurrent')),
        };
      }

      const adapter = await ensureAdapter();

      setSigningState('signing');
      setLastSigningError(null);

      try {
        const result = await adapter.signXdr(xdr);

        if (result.status === 'pending') {
          setSigningState('pending');
          const deferred = createDeferred<WalletSigningResult>();
          pendingSignRef.current = deferred;

          // Defensive timeout: if the wallet app never calls back, fail open
          // after five minutes so the UI is not stuck forever.
          const timeoutId = setTimeout(
            () => {
              if (pendingSignRef.current === deferred) {
                pendingSignRef.current = null;
                const err = new WalletError('unknown', t('wallet.sign.error_timeout'));
                setSigningState('failed');
                setLastSigningError(err);
                deferred.resolve({ status: 'failed', error: err });
              }
            },
            5 * 60 * 1000,
          );

          const finalResult = await deferred.promise;
          clearTimeout(timeoutId);
          return finalResult;
        }

        setSigningState(result.status === 'success' ? 'success' : result.status);
        if (result.error) {
          setLastSigningError(result.error);
        }
        return result;
      } catch (error) {
        const err =
          error instanceof WalletError
            ? error
            : new WalletError('unknown', t('wallet.sign.error_unknown'), error);
        setSigningState('failed');
        setLastSigningError(err);
        return { status: 'failed', error: err };
      }
    },
    [ensureAdapter, signingState, t],
  );

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        status,
        lastConnectedNetwork,
        isRestoring,
        lastRestoreOutcome,
        signingState,
        lastSigningError,
        connect,
        reconnect,
        adoptLinkedAccount,
        disconnect,
        signAndSubmitXdr,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
