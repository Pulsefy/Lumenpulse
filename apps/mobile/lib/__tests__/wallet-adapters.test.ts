import * as Linking from 'expo-linking';

import { getEnvironmentConfig } from '../config';
import { MockWalletAdapter } from '../wallet/adapters/mock-adapter';
import { Sep7WalletAdapter } from '../wallet/adapters/sep7-adapter';
import { XBullWalletAdapter } from '../wallet/adapters/xbull-adapter';
import { parseWalletCallback, signingOutcomeFromCallback } from '../wallet/callback';
import {
  createWalletAdapterRegistry,
  findWalletAdapter,
  getAvailableWalletAdapters,
  getDefaultWalletAdapter,
  resolveWalletSwitch,
} from '../wallet/registry';
import { NETWORK_PASSPHRASES, submitSignedXdr } from '../wallet/submit';
import { WalletAdapter } from '../wallet/types';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `lumenpulse://${path}`,
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

const linking = Linking as unknown as { canOpenURL: jest.Mock; openURL: jest.Mock };
const globalWithSdk = globalThis as unknown as { xBullSDK?: unknown };
const originalFetch = global.fetch;

const CALLBACK = encodeURIComponent('lumenpulse://wallet-callback');
const XDR = 'AAAAAgAAAAA+test/envelope==';
const PUBKEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

type XBullMocks = Partial<Record<'connect' | 'getPublicKey' | 'signXDR', jest.Mock>>;

/** Inject a fake `window.xBullSDK` the way the browser extension does. */
function installXBull(overrides: XBullMocks = {}) {
  const sdk = {
    connect: jest.fn().mockResolvedValue(undefined),
    getPublicKey: jest.fn().mockResolvedValue(PUBKEY),
    signXDR: jest.fn().mockResolvedValue('SIGNED_XDR'),
    ...overrides,
  };
  globalWithSdk.xBullSDK = sdk;
  return sdk;
}

function mockRpcResponse(body: unknown, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValue({ status, json: async () => body });
}

function stubAdapter(id: string, available: boolean | Error): WalletAdapter {
  return {
    id,
    name: id,
    isAvailable: () => {
      if (available instanceof Error) throw available;
      return available;
    },
    connect: async () => ({ status: 'connected' }),
    signXdr: async () => ({ status: 'pending' }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  delete globalWithSdk.xBullSDK;
  global.fetch = originalFetch;
});

describe('Sep7WalletAdapter', () => {
  it('connects through a web+stellar pay link that carries the wallet callback', async () => {
    linking.canOpenURL.mockResolvedValue(true);
    linking.openURL.mockResolvedValue(true);

    await expect(new Sep7WalletAdapter().connect()).resolves.toEqual({ status: 'connected' });

    const url = linking.openURL.mock.calls[0][0] as string;
    expect(url.startsWith('web+stellar:pay?destination=')).toBe(true);
    expect(url.endsWith(`&callback=${CALLBACK}`)).toBe(true);
  });

  it('reports a missing wallet app without opening a link', async () => {
    linking.canOpenURL.mockResolvedValue(false);

    const result = await new Sep7WalletAdapter().connect();

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('missing_wallet');
    expect(linking.openURL).not.toHaveBeenCalled();
  });

  it('treats a failing canOpenURL as unavailable', async () => {
    linking.canOpenURL.mockRejectedValue(new Error('no handler'));

    await expect(new Sep7WalletAdapter().isAvailable()).resolves.toBe(false);
  });

  it('sends the envelope in a web+stellar tx link and waits for the callback', async () => {
    linking.canOpenURL.mockResolvedValue(true);
    linking.openURL.mockResolvedValue(true);

    await expect(new Sep7WalletAdapter().signXdr(XDR)).resolves.toEqual({ status: 'pending' });
    expect(linking.openURL).toHaveBeenCalledWith(
      `web+stellar:tx?xdr=${encodeURIComponent(XDR)}&callback=${CALLBACK}`,
    );
  });

  it('fails when the wallet app cannot be opened', async () => {
    linking.canOpenURL.mockResolvedValue(true);
    linking.openURL.mockRejectedValue(new Error('activity not found'));

    const result = await new Sep7WalletAdapter().signXdr(XDR);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('unsupported_device');
  });

  it('reads a rejected signature from the wallet callback', () => {
    const callback = parseWalletCallback({
      path: 'wallet-callback',
      queryParams: { status: 'rejected' },
    });
    if (!callback) throw new Error('expected a wallet callback');

    expect(signingOutcomeFromCallback(callback)).toEqual({ status: 'rejected' });
  });
});

describe('wallet callback parsing', () => {
  it('ignores links that are not the wallet callback', () => {
    expect(parseWalletCallback({ path: 'news/42', queryParams: { status: 'success' } })).toBeNull();
    expect(parseWalletCallback({ path: null, queryParams: null })).toBeNull();
  });

  it('reads the status, hash and public key', () => {
    expect(
      parseWalletCallback({
        path: 'wallet-callback',
        queryParams: { status: 'success', tx_hash: 'abc123', pubkey: PUBKEY },
      }),
    ).toEqual({ status: 'success', txHash: 'abc123', pubkey: PUBKEY });
  });

  it('keeps the first value of a repeated parameter', () => {
    expect(
      parseWalletCallback({
        path: 'wallet-callback',
        queryParams: { status: ['success', 'rejected'], tx_hash: ['abc123', 'def456'] },
      }),
    ).toEqual({ status: 'success', txHash: 'abc123', pubkey: undefined });
  });

  it('maps each callback to the signing outcome', () => {
    expect(signingOutcomeFromCallback({ status: 'success', txHash: 'abc123' })).toEqual({
      status: 'success',
      txHash: 'abc123',
    });
    expect(signingOutcomeFromCallback({ status: 'success' })).toEqual({ status: 'unknown' });
    expect(signingOutcomeFromCallback({ status: 'failed' })).toEqual({ status: 'failed' });
    expect(signingOutcomeFromCallback({})).toEqual({ status: 'unknown' });
  });
});

describe('XBullWalletAdapter', () => {
  it('is only available on the web target with the extension injected', () => {
    expect(new XBullWalletAdapter('web').isAvailable()).toBe(false);

    installXBull();

    expect(new XBullWalletAdapter('web').isAvailable()).toBe(true);
    expect(new XBullWalletAdapter('ios').isAvailable()).toBe(false);
    expect(new XBullWalletAdapter('android').isAvailable()).toBe(false);
    // Defaults to Platform.OS, which is a native platform under Jest.
    expect(new XBullWalletAdapter().isAvailable()).toBe(false);
  });

  it('connects and returns the public key', async () => {
    const sdk = installXBull();

    await expect(new XBullWalletAdapter('web').connect()).resolves.toEqual({
      status: 'connected',
      pubkey: PUBKEY,
    });
    expect(sdk.connect).toHaveBeenCalledWith({ canRequestPublicKey: true, canRequestSign: true });
  });

  it('maps a declined connection to rejected', async () => {
    installXBull({ connect: jest.fn().mockRejectedValue(new Error('User declined access')) });

    const result = await new XBullWalletAdapter('web').connect();

    expect(result.status).toBe('rejected');
    expect(result.error?.code).toBe('rejected');
  });

  it('refuses to connect off the web target or without the extension', async () => {
    installXBull();
    expect((await new XBullWalletAdapter('android').connect()).error?.code).toBe(
      'unsupported_device',
    );

    delete globalWithSdk.xBullSDK;
    expect((await new XBullWalletAdapter('web').connect()).error?.code).toBe('missing_wallet');
  });

  it('signs for the active network and submits the signed envelope', async () => {
    const sdk = installXBull();
    mockRpcResponse({ jsonrpc: '2.0', id: 1, result: { status: 'PENDING', hash: 'abc123' } });

    const result = await new XBullWalletAdapter('web').signXdr(XDR);

    expect(result).toEqual({ status: 'success', signedXdr: 'SIGNED_XDR', txHash: 'abc123' });
    expect(sdk.signXDR).toHaveBeenCalledWith(XDR, {
      network: NETWORK_PASSPHRASES.testnet,
      publicKey: undefined,
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(getEnvironmentConfig().sorobanRpcUrl);
    expect(JSON.parse(init.body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: 'SIGNED_XDR' },
    });
  });

  it('passes the network and account chosen by the caller', async () => {
    const sdk = installXBull();
    mockRpcResponse({ result: { status: 'PENDING', hash: 'abc123' } });

    await new XBullWalletAdapter('web').signXdr(XDR, {
      networkPassphrase: NETWORK_PASSPHRASES.mainnet,
      address: PUBKEY,
    });

    expect(sdk.signXDR).toHaveBeenCalledWith(XDR, {
      network: NETWORK_PASSPHRASES.mainnet,
      publicKey: PUBKEY,
    });
  });

  it('maps a declined signature to rejected without submitting anything', async () => {
    installXBull({ signXDR: jest.fn().mockRejectedValue(new Error('User rejected the request')) });

    const result = await new XBullWalletAdapter('web').signXdr(XDR);

    expect(result.status).toBe('rejected');
    expect(result.error?.code).toBe('rejected');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports a submission the network refused and keeps the signed envelope', async () => {
    installXBull();
    mockRpcResponse({ result: { status: 'ERROR', hash: 'abc123', errorResultXdr: 'AAAA' } });

    const result = await new XBullWalletAdapter('web').signXdr(XDR);

    expect(result.status).toBe('failed');
    expect(result.signedXdr).toBe('SIGNED_XDR');
    expect(result.error?.message).toBe('Transaction submission returned ERROR.');
  });
});

describe('MockWalletAdapter', () => {
  it('connects with the fixed development key', async () => {
    const result = await new MockWalletAdapter(true).connect();

    expect(result.status).toBe('connected');
    expect(result.pubkey).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('signs and returns a transaction hash', async () => {
    const result = await new MockWalletAdapter(true).signXdr(XDR);

    expect(result.status).toBe('success');
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to connect or sign when disabled', async () => {
    const adapter = new MockWalletAdapter(false);

    expect(adapter.isAvailable()).toBe(false);
    expect((await adapter.connect()).error?.code).toBe('not_available');
    expect((await adapter.signXdr(XDR)).error?.code).toBe('not_available');
  });
});

describe('submitSignedXdr', () => {
  it('accepts a duplicate submission as already sent', async () => {
    mockRpcResponse({ result: { status: 'DUPLICATE', hash: 'dup123' } });

    await expect(submitSignedXdr('SIGNED_XDR', 'https://rpc.example')).resolves.toEqual({
      status: 'success',
      signedXdr: 'SIGNED_XDR',
      txHash: 'dup123',
    });
  });

  it('surfaces the JSON-RPC error message', async () => {
    mockRpcResponse({ error: { code: -32602, message: 'invalid transaction' } });

    const result = await submitSignedXdr('SIGNED_XDR', 'https://rpc.example');

    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('invalid transaction');
  });

  it('does not call the network when no RPC URL is configured', async () => {
    const result = await submitSignedXdr('SIGNED_XDR', '');

    expect(result.error?.code).toBe('not_available');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails when the RPC cannot be reached', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const result = await submitSignedXdr('SIGNED_XDR', 'https://rpc.example');

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('unknown');
  });
});

describe('wallet registry', () => {
  it('keeps SEP-0007 first on iOS and Android', () => {
    expect(createWalletAdapterRegistry(false, 'ios').map((a) => a.id)).toEqual(['sep7', 'xbull']);
    expect(createWalletAdapterRegistry(false, 'android').map((a) => a.id)).toEqual([
      'sep7',
      'xbull',
    ]);
  });

  it('puts xBull first on the web target', () => {
    expect(createWalletAdapterRegistry(false, 'web').map((a) => a.id)).toEqual(['xbull', 'sep7']);
  });

  it('appends the mock adapter last in development builds only', () => {
    expect(createWalletAdapterRegistry(true, 'ios').map((a) => a.id)).toEqual([
      'sep7',
      'xbull',
      'mock',
    ]);
  });

  it('lists available adapters in order and skips checks that throw', async () => {
    const adapters = [
      stubAdapter('a', true),
      stubAdapter('b', false),
      stubAdapter('c', new Error('boom')),
      stubAdapter('d', true),
    ];

    expect((await getAvailableWalletAdapters(adapters)).map((a) => a.id)).toEqual(['a', 'd']);
  });

  it('defaults to SEP-0007 on native, even with no wallet app installed', async () => {
    linking.canOpenURL.mockResolvedValue(false);
    expect((await getDefaultWalletAdapter(false)).id).toBe('sep7');

    linking.canOpenURL.mockResolvedValue(true);
    expect((await getDefaultWalletAdapter(false)).id).toBe('sep7');
  });

  it('finds adapters by id', () => {
    expect(findWalletAdapter('xbull')?.name).toBe('xBull');
    expect(findWalletAdapter('nope')).toBeUndefined();
    expect(findWalletAdapter(null)).toBeUndefined();
  });
});

describe('resolveWalletSwitch', () => {
  const adapters = createWalletAdapterRegistry(true, 'ios');

  it('keeps the current wallet when it is picked again', () => {
    expect(resolveWalletSwitch('sep7', 'sep7', 'pending', adapters)).toEqual({
      status: 'unchanged',
    });
  });

  it('refuses to switch while a signature is in flight', () => {
    expect(resolveWalletSwitch('sep7', 'mock', 'signing', adapters)).toEqual({ status: 'busy' });
    expect(resolveWalletSwitch('sep7', 'mock', 'pending', adapters)).toEqual({ status: 'busy' });
  });

  it('rejects an unknown wallet id', () => {
    expect(resolveWalletSwitch('sep7', 'freighter', 'idle', adapters)).toEqual({
      status: 'unknown',
    });
  });

  it('returns the adapter to install once signing has settled', () => {
    for (const state of ['idle', 'success', 'rejected', 'failed'] as const) {
      const decision = resolveWalletSwitch('sep7', 'mock', state, adapters);

      expect(decision.status).toBe('switch');
      expect(decision.status === 'switch' ? decision.adapter.id : null).toBe('mock');
    }
  });
});
