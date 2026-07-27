import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { useLocalization } from '../src/context';
import { useEnvironment } from './EnvironmentContext';
import { storage, WalletNetworkTag, sanitizePublicKey } from '../lib/storage';

export type WalletStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'signing'
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
  signAndSubmitXdr: (
    xdr: string,
  ) => Promise<{ status: 'success' | 'rejected' | 'failed'; txHash?: string }>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletStatus>('disconnected');
  const [lastConnectedNetwork, setLastConnectedNetwork] =
    useState<WalletNetworkTag | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [lastRestoreOutcome, setLastRestoreOutcome] =
    useState<WalletRestoreOutcome | null>(null);
  const { t } = useLocalization();
  const { environment, isInitialized: isEnvironmentReady } = useEnvironment();
  // Tracks whether a restore attempt has completed at least once so we
  // don't re-clear a freshly connected session when the environment
  // re-resolves during normal app use.
  const hasRestoredRef = useRef(false);

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

        // Handle Albedo/Lobstr callbacks
        if (parsedUrl.path === 'wallet-callback') {
          const { status: cbStatus, tx_hash: txHash, pubkey } = parsedUrl.queryParams || {};

          if (status === 'connecting' || status === 'reconnecting') {
            if (pubkey) {
              const cleanKey = sanitizePublicKey(pubkey);
              setPublicKey(cleanKey);
              setStatus('connected');
              setLastConnectedNetwork(environment);
              if (cleanKey) {
                void storage.setActiveWalletPublicKey(cleanKey, environment);
              }
            }
          } else if (cbStatus === 'success') {
            setStatus('connected');
          } else if (cbStatus === 'rejected') {
            setStatus(publicKey ? 'connected' : 'rejected');
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

  const showConnectionDialog = useCallback(
    (intent: 'connect' | 'reconnect') => {
      // SEP-0007 web+stellar:auth or pay
      // Since proper SEP-0007 auth requires a backend challenge, we'll simulate a wallet connection via a generic deep link or fallback to a Mock Wallet for testnet.
      const title = intent === 'reconnect' ? t('wallet.reconnect.title') : t('wallet.connect.title');
      const message =
        intent === 'reconnect'
          ? t('wallet.reconnect.message', { network: environment })
          : t('wallet.connect.message', { network: environment });

      return new Promise<{ status: 'connected' | 'rejected' | 'failed'; pubkey: string | null }>(
        (resolve) => {
          Alert.alert(title, message, [
            {
              text: t('common.cancel'),
              style: 'cancel',
              onPress: () => {
                // Only escalate to 'network_mismatch' if there actually was a
                // stale session pointing at the wrong network. Otherwise the
                // user just canceled from a generic "no session" state and
                // should return to a neutral disconnected state.
                setStatus((prev) =>
                  intent === 'reconnect' && prev === 'network_mismatch'
                    ? 'network_mismatch'
                    : intent === 'reconnect'
                      ? 'disconnected'
                      : 'rejected',
                );
                resolve({ status: 'rejected', pubkey: null });
              },
            },
            {
              text: t('wallet.connect.mock_button'),
              onPress: () => {
                // Generate a mock testnet public key for testing
                const mockKey =
                  'G' +
                  Array.from(
                    { length: 55 },
                    () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(Math.random() * 32)],
                  ).join('');
                resolve({ status: 'connected', pubkey: mockKey });
              },
            },
            {
              text: t('wallet.connect.deep_link_button'),
              onPress: async () => {
                // Attempt to open a real wallet
                const callbackUrl = encodeURIComponent(Linking.createURL('wallet-callback'));
                const url = `web+stellar:pay?destination=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF&amount=0&callback=${callbackUrl}`;
                const canOpen = await Linking.canOpenURL(url);
                if (canOpen) {
                  await Linking.openURL(url);
                  // Deep link flow resolves async via the callback listener.
                  resolve({ status: 'connected', pubkey: null });
                } else {
                  Alert.alert(
                    t('wallet.connect.no_wallet_title'),
                    t('wallet.connect.no_wallet_message'),
                  );
                  setStatus('disconnected');
                  resolve({ status: 'failed', pubkey: null });
                }
              },
            },
          ]);
        },
      );
    },
    [environment, t],
  );

  const connect = useCallback(async () => {
    setStatus('connecting');
    try {
      const result = await showConnectionDialog('connect');
      if (result.status === 'connected' && result.pubkey) {
        await finalizeConnection(result.pubkey);
      } else if (result.status === 'connected') {
        // Deep link path: status will flip to 'connected' when callback fires.
        setStatus('connecting');
      }
    } catch (error) {
      console.error('connect failed:', error);
      setStatus('rejected');
    }
  }, [finalizeConnection, showConnectionDialog]);

  const reconnect = useCallback(async () => {
    const priorMismatch = status === 'network_mismatch';
    setStatus('reconnecting');
    try {
      const result = await showConnectionDialog('reconnect');
      if (result.status === 'connected' && result.pubkey) {
        await finalizeConnection(result.pubkey);
      } else if (result.status === 'connected') {
        setStatus('reconnecting');
      } else if (priorMismatch) {
        // Only keep the mismatch state if the user got there via a real
        // mismatch. Otherwise restore a neutral disconnected state.
        setStatus('network_mismatch');
      } else {
        setStatus('disconnected');
      }
    } catch (error) {
      console.error('reconnect failed:', error);
      setStatus(priorMismatch ? 'network_mismatch' : 'disconnected');
    }
  }, [finalizeConnection, showConnectionDialog, status]);

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
    try {
      await storage.clearActiveWalletSession();
    } catch (error) {
      console.error('Error clearing wallet session during disconnect:', error);
    }
  }, []);

  const signAndSubmitXdr = useCallback(
    async (
      xdr: string,
    ): Promise<{ status: 'success' | 'rejected' | 'failed'; txHash?: string }> => {
      setStatus('signing');

      return new Promise((resolve) => {
        Alert.alert(t('wallet.sign.title'), t('wallet.sign.message'), [
          {
            text: t('wallet.sign.reject'),
            style: 'cancel',
            onPress: () => {
              setStatus('connected');
              resolve({ status: 'rejected' });
            },
          },
          {
            text: t('wallet.sign.sign_mock'),
            onPress: () => {
              // Simulate network delay
              setTimeout(() => {
                setStatus('connected');
                // Generate a fake transaction hash
                const mockHash = Array.from(
                  { length: 64 },
                  () => '0123456789abcdef'[Math.floor(Math.random() * 16)],
                ).join('');
                resolve({ status: 'success', txHash: mockHash });
              }, 1500);
            },
          },
          {
            text: t('wallet.sign.open_app'),
            onPress: async () => {
              const callbackUrl = encodeURIComponent(Linking.createURL('wallet-callback'));
              const url = `web+stellar:tx?xdr=${encodeURIComponent(xdr)}&callback=${callbackUrl}`;
              const canOpen = await Linking.canOpenURL(url);
              if (canOpen) {
                await Linking.openURL(url);
                setStatus('connected');
                resolve({ status: 'success', txHash: 'pending_via_deeplink' });
              } else {
                Alert.alert(t('wallet.sign.error_title'), t('wallet.sign.error_no_wallet'));
                setStatus('connected');
                resolve({ status: 'failed' });
              }
            },
          },
        ]);
      });
    },
    [t],
  );

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        status,
        lastConnectedNetwork,
        isRestoring,
        lastRestoreOutcome,
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
