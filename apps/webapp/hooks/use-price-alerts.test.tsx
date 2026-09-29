import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PriceAlertsProvider, usePriceAlerts } from './use-price-alerts';
import { PriceAlertApiService, PriceAlertRule } from '@/lib/price-alert-service';

function rule(overrides: Partial<PriceAlertRule> = {}): PriceAlertRule {
  return {
    id: 'rule-1',
    userId: 'user-1',
    symbol: 'XLM',
    targetPrice: 0.15,
    condition: 'above',
    isActive: true,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PriceAlertsProvider>{children}</PriceAlertsProvider>
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderLoaded(initial: PriceAlertRule[]) {
  vi.spyOn(PriceAlertApiService, 'list').mockResolvedValue(initial);
  const hook = renderHook(() => usePriceAlerts(), { wrapper });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePriceAlerts', () => {
  it('loads rules on mount', async () => {
    const { result } = await renderLoaded([rule()]);
    expect(result.current.rules).toEqual([rule()]);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch while disabled', () => {
    const list = vi.spyOn(PriceAlertApiService, 'list').mockResolvedValue([]);
    renderHook(() => usePriceAlerts(), {
      wrapper: ({ children }) => <PriceAlertsProvider enabled={false}>{children}</PriceAlertsProvider>,
    });
    expect(list).not.toHaveBeenCalled();
  });

  it('exposes load errors separately from mutation errors', async () => {
    vi.spyOn(PriceAlertApiService, 'list').mockRejectedValue(new Error('Network down'));
    const { result } = renderHook(() => usePriceAlerts(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('Network down'));
    expect(result.current.mutationError).toBeNull();
  });

  it('getRule replaces the cached rule with the server copy', async () => {
    const { result } = await renderLoaded([rule()]);
    vi.spyOn(PriceAlertApiService, 'get').mockResolvedValue(rule({ targetPrice: 0.2 }));

    await act(async () => {
      await result.current.getRule('rule-1');
    });

    expect(result.current.rules[0].targetPrice).toBe(0.2);
  });

  it('createRule shows an optimistic row, then swaps in the created rule', async () => {
    const { result } = await renderLoaded([]);
    const pending = deferred<PriceAlertRule>();
    vi.spyOn(PriceAlertApiService, 'create').mockReturnValue(pending.promise);

    let createPromise!: Promise<PriceAlertRule>;
    act(() => {
      createPromise = result.current.createRule({ symbol: 'usdc', targetPrice: 1, condition: 'below' });
    });

    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0].id).toMatch(/^temp-/);
    expect(result.current.rules[0].symbol).toBe('USDC');
    expect(result.current.isSyncing).toBe(true);

    await act(async () => {
      pending.resolve(rule({ id: 'rule-2', symbol: 'USDC', condition: 'below', targetPrice: 1 }));
      await createPromise;
    });

    expect(result.current.rules.map((r) => r.id)).toEqual(['rule-2']);
    expect(result.current.isSyncing).toBe(false);
  });

  it('createRule removes the optimistic row when the request fails', async () => {
    const { result } = await renderLoaded([rule()]);
    vi.spyOn(PriceAlertApiService, 'create').mockRejectedValue(new Error('Invalid symbol'));

    await act(async () => {
      await expect(
        result.current.createRule({ symbol: 'BAD', targetPrice: 1, condition: 'above' }),
      ).rejects.toThrow('Invalid symbol');
    });

    expect(result.current.rules).toEqual([rule()]);
    expect(result.current.mutationError).toBe('Invalid symbol');
  });

  it('updateRule rolls back only the edited rule on failure', async () => {
    const other = rule({ id: 'rule-2', symbol: 'BTC' });
    const { result } = await renderLoaded([rule(), other]);
    vi.spyOn(PriceAlertApiService, 'update').mockRejectedValue(new Error('Server error'));

    await act(async () => {
      await expect(result.current.updateRule('rule-1', { isActive: false })).rejects.toThrow();
    });

    expect(result.current.rules).toEqual([rule(), other]);
    expect(result.current.mutationError).toBe('Server error');
  });

  it('removeRule is optimistic and restores the rule at its original position on failure', async () => {
    const first = rule({ id: 'a', symbol: 'AAA' });
    const middle = rule({ id: 'b', symbol: 'BBB' });
    const last = rule({ id: 'c', symbol: 'CCC' });
    const { result } = await renderLoaded([first, middle, last]);
    const pending = deferred<void>();
    vi.spyOn(PriceAlertApiService, 'remove').mockReturnValue(pending.promise);

    let removePromise!: Promise<void>;
    act(() => {
      removePromise = result.current.removeRule('b');
    });

    // Gone immediately, before the server responds.
    expect(result.current.rules.map((r) => r.id)).toEqual(['a', 'c']);

    await act(async () => {
      pending.reject(new Error('Delete failed'));
      await removePromise.catch(() => {});
    });

    expect(result.current.rules.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.mutationError).toBe('Delete failed');
  });

  it('removeRule keeps the rule removed when the request succeeds', async () => {
    const { result } = await renderLoaded([rule()]);
    const remove = vi.spyOn(PriceAlertApiService, 'remove').mockResolvedValue();

    await act(async () => {
      await result.current.removeRule('rule-1');
    });

    expect(remove).toHaveBeenCalledWith('rule-1');
    expect(result.current.rules).toEqual([]);
    expect(result.current.mutationError).toBeNull();
  });
});
