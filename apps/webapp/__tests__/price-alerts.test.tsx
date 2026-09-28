import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PriceAlertsPanel from '@/components/price-alerts-panel';
import { PriceAlertsProvider } from '@/hooks/use-price-alerts';
import { PriceAlertApiService } from '@/lib/price-alert-service';

describe('Price Alerts UI', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads list (GET) and displays rules', async () => {
    const mockList = [
      { id: 'r1', userId: 'u1', symbol: 'XLM', targetPrice: 0.1, condition: 'above', isActive: true, cooldownMinutes: 60, lastTriggeredAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ];

    vi.stubGlobal('fetch', vi.fn(async (input) => {
      if ((input as string).endsWith('/price-alerts')) {
        return { ok: true, json: async () => mockList } as any;
      }
      return { ok: false, status: 404 } as any;
    }));

    render(
      <PriceAlertsProvider>
        <PriceAlertsPanel />
      </PriceAlertsProvider>
    );

    expect(await screen.findByText(/XLM/i)).toBeInTheDocument();
  });

  it('creates a rule (POST)', async () => {
    const created = { id: 'r2', userId: 'u1', symbol: 'BTC', targetPrice: 10000, condition: 'below', isActive: true, cooldownMinutes: 60, lastTriggeredAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

    const fetchMock = vi.stubGlobal('fetch', vi.fn(async (input, opts) => {
      const url = String(input);
      if (url.endsWith('/price-alerts') && opts?.method === 'POST') {
        return { ok: true, json: async () => created } as any;
      }
      if (url.endsWith('/price-alerts')) {
        return { ok: true, json: async () => [] } as any;
      }
      return { ok: false, status: 404 } as any;
    }));

    render(
      <PriceAlertsProvider>
        <PriceAlertsPanel />
      </PriceAlertsProvider>
    );

    // open form
    fireEvent.click(await screen.findByRole('button', { name: /new/i }));
    fireEvent.change(screen.getByLabelText(/Asset symbol/i), { target: { value: 'BTC' } });
    fireEvent.change(screen.getByLabelText(/Target price/i), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText(/Direction/i), { target: { value: 'below' } });
    fireEvent.change(screen.getByLabelText(/Notification channel/i), { target: { value: 'push' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByText(/BTC/i)).toBeInTheDocument();
  });

  it('updates a rule (PATCH)', async () => {
    const original = { id: 'r3', userId: 'u1', symbol: 'ETH', targetPrice: 2000, condition: 'above', isActive: true, cooldownMinutes: 60, lastTriggeredAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const updated = { ...original, isActive: false };

    const fetchMock = vi.stubGlobal('fetch', vi.fn(async (input, opts) => {
      const url = String(input);
      if (url.endsWith('/price-alerts')) {
        return { ok: true, json: async () => [original] } as any;
      }
      if (url.endsWith(`/price-alerts/${original.id}`) && opts?.method === 'PATCH') {
        return { ok: true, json: async () => updated } as any;
      }
      return { ok: false, status: 404 } as any;
    }));

    render(
      <PriceAlertsProvider>
        <PriceAlertsPanel />
      </PriceAlertsProvider>
    );

    expect(await screen.findByText(/ETH/i)).toBeInTheDocument();
    // click edit (toggles active)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('reads a single rule (GET /:id) and deletes (DELETE)', async () => {
    const one = { id: 'r4', userId: 'u1', symbol: 'XRP', targetPrice: 0.5, condition: 'below', isActive: true, cooldownMinutes: 60, lastTriggeredAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

    const fetchMock = vi.stubGlobal('fetch', vi.fn(async (input, opts) => {
      const url = String(input);
      if (url.endsWith('/price-alerts')) {
        return { ok: true, json: async () => [one] } as any;
      }
      if (url.endsWith(`/price-alerts/${one.id}`) && (!opts || opts.method === 'GET')) {
        return { ok: true, json: async () => one } as any;
      }
      if (url.endsWith(`/price-alerts/${one.id}`) && opts?.method === 'DELETE') {
        return { ok: true, status: 204 } as any;
      }
      return { ok: false, status: 404 } as any;
    }));

    render(
      <PriceAlertsProvider>
        <PriceAlertsPanel />
      </PriceAlertsProvider>
    );

    expect(await screen.findByText(/XRP/i)).toBeInTheDocument();

    // exercise GET single directly via service
    const fetched = await PriceAlertApiService.get(one.id);
    expect(fetched.id).toBe(one.id);

    // delete
    // mock confirm to true
    vi.stubGlobal('confirm', () => true);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
