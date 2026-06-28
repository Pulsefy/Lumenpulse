import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StellarConfigProvider, useStellarConfig } from './StellarConfigContext'
import type { StellarConfig } from '@/types/stellar-config'

const MOCK_CONFIG: StellarConfig = {
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contracts: {
    lumenToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    crowdfundVault: null,
    projectRegistry: null,
    contributorRegistry: null,
    matchingPool: null,
    treasury: null,
  },
}

function TestConsumer() {
  const { config, status, error, retry } = useStellarConfig()
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="network">{config?.network ?? 'null'}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <button onClick={retry}>retry</button>
    </div>
  )
}

describe('StellarConfigProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts in loading state', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    expect(screen.getByTestId('status').textContent).toBe('loading')
    expect(screen.getByTestId('network').textContent).toBe('null')
  })

  it('transitions to ready and exposes config on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
    )
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    await act(async () => { await vi.runAllTimersAsync() })
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('ready')
    )
    expect(screen.getByTestId('network').textContent).toBe('testnet')
    expect(screen.getByTestId('error').textContent).toBe('null')
  })

  it('transitions to error when backend returns non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 502 })
    )
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    await act(async () => { await vi.runAllTimersAsync() })
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('error')
    )
    expect(screen.getByTestId('error').textContent).not.toBe('null')
  })

  it('transitions to error when fetch throws (network failure)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network failure'))
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    await act(async () => { await vi.runAllTimersAsync() })
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('error')
    )
    expect(screen.getByTestId('error').textContent).toContain('Network failure')
  })


  it('transitions to error with descriptive message when network is unsupported', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...MOCK_CONFIG, network: 'devnet' }),
        { status: 200 }
      )
    )
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    await act(async () => { await vi.runAllTimersAsync() })
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('error')
    )
    expect(screen.getByTestId('error').textContent).toMatch(/unsupported environment/i)
  })

  it('transitions to error with descriptive message when contracts are missing', async () => {
    const { contracts: _contracts, ...withoutContracts } = MOCK_CONFIG
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(withoutContracts), { status: 200 })
    )
    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    await act(async () => { await vi.runAllTimersAsync() })
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('error')
    )
    expect(screen.getByTestId('error').textContent).toMatch(/contract configuration is missing/i)
  })

  it('does not update state after unmount', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    const { unmount } = render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )
    unmount()
    await act(async () => { await vi.runAllTimersAsync() })
  })
})

describe('StellarConfigProvider — retry with real timers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-fetches and reaches ready after retry()', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockResolvedValue(
        new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
      )

    render(
      <StellarConfigProvider>
        <TestConsumer />
      </StellarConfigProvider>
    )

    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('error'),
      { timeout: 15000 }
    )

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(MOCK_CONFIG), { status: 200 })
    )

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    })

    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('ready'),
      { timeout: 5000 }
    )
    expect(screen.getByTestId('network').textContent).toBe('testnet')
  }, 20000)
})
