import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletProvider, useWallet, type Wallet } from './WalletContext';

const MOCK_WALLETS: Wallet[] = [
  {
    id: 'wallet-1',
    label: 'Primary Account',
    address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    chain: 'XLM',
    balance: '1,250.50 XLM',
    balanceUSD: 156.31,
    change24h: '+2.4%',
    changePositive: true,
    assetCount: 3,
  },
  {
    id: 'wallet-2',
    label: 'Savings Vault',
    address: 'GBRPYHIL2C6Q2XQY5W4O6OQK5C6G3XQ2M3NQ5H1R8S9T0U1V2W3X4Y5Z',
    chain: 'USDC',
    balance: '500.00 USDC',
    balanceUSD: 500.0,
    change24h: '+0.1%',
    changePositive: true,
    assetCount: 1,
  },
];

function TestConsumer() {
  const { wallets, activeWallet, isLoading, error, switchWallet, retry } = useWallet();

  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="wallet-count">{wallets.length}</span>
      <span data-testid="active-wallet-id">{activeWallet?.id ?? 'none'}</span>
      <span data-testid="error">{error ?? 'none'}</span>
      <button onClick={() => switchWallet('wallet-2')}>switch-to-wallet-2</button>
      <button onClick={() => void retry()}>do-reload</button>
    </div>
  );
}

describe('WalletContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('handles populated wallets case and defaults active wallet to first entry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_WALLETS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    expect(screen.getByTestId('loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('wallet-count').textContent).toBe('2');
    expect(screen.getByTestId('active-wallet-id').textContent).toBe('wallet-1');
    expect(screen.getByTestId('error').textContent).toBe('none');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('handles empty wallets case cleanly', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('wallet-count').textContent).toBe('0');
    expect(screen.getByTestId('active-wallet-id').textContent).toBe('none');
    expect(screen.getByTestId('error').textContent).toBe('none');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces visible error state when fetch returns HTTP error (e.g. 404 or 500)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        statusText: 'Not Found',
      })
    );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('wallet-count').textContent).toBe('0');
    expect(screen.getByTestId('active-wallet-id').textContent).toBe('none');
    expect(screen.getByTestId('error').textContent).toMatch(/404/);

    // Visible error banner is rendered in the DOM
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/Failed to fetch wallets: 404/);
  });

  it('surfaces visible error state when fetch throws network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network offline'));

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('wallet-count').textContent).toBe('0');
    expect(screen.getByTestId('active-wallet-id').textContent).toBe('none');
    expect(screen.getByTestId('error').textContent).toBe('Network offline');

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Network offline');
  });

  it('restores active wallet from localStorage once real data is returned', async () => {
    localStorage.setItem('activeWalletId', 'wallet-2');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_WALLETS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('active-wallet-id').textContent).toBe('wallet-2');
  });

  it('switches wallet and persists activeWalletId to localStorage', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_WALLETS), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('active-wallet-id').textContent).toBe('wallet-1');

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /switch-to-wallet-2/i }));
    });

    expect(screen.getByTestId('active-wallet-id').textContent).toBe('wallet-2');
    expect(localStorage.getItem('activeWalletId')).toBe('wallet-2');
  });

  it('recovers from failed fetch when retry succeeds', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('Temporary disconnect'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(MOCK_WALLETS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Temporary disconnect');
    });

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('none');
    });

    expect(screen.getByTestId('wallet-count').textContent).toBe('2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
