import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PriceAlertsPanel from './price-alerts-panel';
import { PriceAlertsProvider } from '@/hooks/use-price-alerts';

type Handler = (init: RequestInit, id?: string) => Response | Promise<Response>;

interface Routes {
  list?: Handler;
  get?: Handler;
  create?: Handler;
  update?: Handler;
  remove?: Handler;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const recentlyFired = new Date(Date.now() - 5 * 60 * 1000).toISOString();

const RULES = [
  {
    id: 'rule-active',
    userId: 'u',
    symbol: 'XLM',
    targetPrice: '0.15000000',
    condition: 'above',
    isActive: true,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'rule-triggered',
    userId: 'u',
    symbol: 'BTC',
    targetPrice: '50000.00000000',
    condition: 'below',
    isActive: true,
    cooldownMinutes: 60,
    lastTriggeredAt: recentlyFired,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'rule-muted',
    userId: 'u',
    symbol: 'USDC',
    targetPrice: '1.00000000',
    condition: 'below',
    isActive: false,
    cooldownMinutes: 60,
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const fetchMock = vi.fn();

function mockApi(routes: Routes) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const match = /\/price-alerts(?:\/([^/?]+))?$/.exec(url);
    if (!match) throw new Error(`Unexpected request: ${method} ${url}`);
    const id = match[1] ? decodeURIComponent(match[1]) : undefined;

    const handler =
      method === 'GET' && !id ? routes.list
      : method === 'GET' ? routes.get
      : method === 'POST' ? routes.create
      : method === 'PATCH' ? routes.update
      : method === 'DELETE' ? routes.remove
      : undefined;

    if (!handler) throw new Error(`No mock for ${method} ${url}`);
    return handler(init, id);
  });
}

function callsTo(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method);
}

function renderPanel() {
  return render(
    <PriceAlertsProvider>
      <PriceAlertsPanel />
    </PriceAlertsProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PriceAlertsPanel', () => {
  it('lists rules with their active, triggered and muted state', async () => {
    mockApi({ list: () => json(RULES) });
    renderPanel();

    const states = await screen.findAllByTestId('price-alert-state');
    expect(states.map((el) => el.textContent)).toEqual(['Active', 'Triggered', 'Muted']);
    expect(within(screen.getByTestId('price-alert-rule-active')).getByText('XLM')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rules', async () => {
    mockApi({ list: () => json([]) });
    renderPanel();

    expect(await screen.findByText('No price alerts yet')).toBeInTheDocument();
  });

  it('shows a retryable error when loading fails', async () => {
    let attempts = 0;
    mockApi({
      list: () => (attempts++ === 0 ? json({ message: 'Service unavailable' }, 503) : json(RULES)),
    });
    renderPanel();

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findAllByTestId('price-alert-state')).toHaveLength(3);
  });

  it('validates asset, threshold, direction and channel before submitting', async () => {
    mockApi({ list: () => json([]) });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /new alert/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Threshold price'), '-5');
    await user.selectOptions(within(dialog).getByLabelText('Notification channel'), '');
    await user.click(within(dialog).getByRole('button', { name: /create alert/i }));

    expect(within(dialog).getByText('Enter an asset symbol.')).toBeInTheDocument();
    expect(within(dialog).getByText('Threshold must be a number greater than 0.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a notification channel.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Asset')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo('POST')).toHaveLength(0);
  });

  it('creates a rule through POST /price-alerts', async () => {
    const created = { ...RULES[0], id: 'rule-new', symbol: 'USDC', targetPrice: '1.01000000', condition: 'below' };
    mockApi({ list: () => json([]), create: () => json(created, 201) });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /new alert/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Asset'), 'usdc');
    await user.type(within(dialog).getByLabelText('Threshold price'), '1.01');
    await user.selectOptions(within(dialog).getByLabelText('Direction'), 'below');
    await user.selectOptions(within(dialog).getByLabelText('Notification channel'), 'email');
    await user.click(within(dialog).getByRole('button', { name: /create alert/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [[, init]] = callsTo('POST') as [string, RequestInit][];
    expect(JSON.parse(init.body as string)).toEqual({
      symbol: 'USDC',
      targetPrice: 1.01,
      condition: 'below',
      cooldownMinutes: 60,
    });
    expect(await screen.findByTestId('price-alert-rule-new')).toBeInTheDocument();
  });

  it('keeps the form open with the server error when create fails', async () => {
    mockApi({ list: () => json([]), create: () => json({ message: 'Unsupported asset' }, 400) });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /new alert/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Asset'), 'ZZZ');
    await user.type(within(dialog).getByLabelText('Threshold price'), '2');
    await user.click(within(dialog).getByRole('button', { name: /create alert/i }));

    expect(await within(dialog).findByText('Unsupported asset')).toBeInTheDocument();
    expect(screen.queryByTestId(/^price-alert-temp-/)).not.toBeInTheDocument();
  });

  it('edits a rule: re-reads it via GET /price-alerts/:id, then PATCHes the changes', async () => {
    const serverCopy = { ...RULES[0], targetPrice: '0.18000000' };
    mockApi({
      list: () => json([RULES[0]]),
      get: () => json(serverCopy),
      update: (init) => json({ ...serverCopy, ...JSON.parse(init.body as string), targetPrice: '0.25000000' }),
    });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit XLM above 0.15' }));
    const dialog = await screen.findByRole('dialog');
    expect(callsTo('GET').some(([url]) => /\/price-alerts\/rule-active$/.test(url as string))).toBe(true);

    const price = within(dialog).getByLabelText('Threshold price');
    expect(price).toHaveValue('0.18');
    expect(within(dialog).getByLabelText('Asset')).toBeDisabled();

    await user.clear(price);
    await user.type(price, '0.25');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [[url, init]] = callsTo('PATCH') as [string, RequestInit][];
    expect(url).toMatch(/\/price-alerts\/rule-active$/);
    expect(JSON.parse(init.body as string)).toEqual({ targetPrice: 0.25, condition: 'above', cooldownMinutes: 60 });
    expect(await screen.findByRole('button', { name: 'Edit XLM above 0.25' })).toBeInTheDocument();
  });

  it('mutes a rule through PATCH { isActive: false }', async () => {
    mockApi({
      list: () => json([RULES[0]]),
      update: () => json({ ...RULES[0], isActive: false }),
    });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Mute XLM above 0.15' }));

    await waitFor(() => expect(screen.getByTestId('price-alert-state')).toHaveTextContent('Muted'));
    const [[, init]] = callsTo('PATCH') as [string, RequestInit][];
    expect(JSON.parse(init.body as string)).toEqual({ isActive: false });
  });

  it('asks for confirmation before deleting, and cancelling sends nothing', async () => {
    mockApi({ list: () => json([RULES[0]]), remove: () => new Response(null, { status: 204 }) });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete XLM above 0.15' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/can't be undone/i)).toBeInTheDocument();

    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(callsTo('DELETE')).toHaveLength(0);
    expect(screen.getByTestId('price-alert-rule-active')).toBeInTheDocument();
  });

  it('deletes optimistically through DELETE /price-alerts/:id', async () => {
    let resolveDelete!: (r: Response) => void;
    mockApi({
      list: () => json([RULES[0]]),
      remove: () => new Promise<Response>((resolve) => (resolveDelete = resolve)),
    });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete XLM above 0.15' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    // Removed before the server has answered.
    expect(screen.queryByTestId('price-alert-rule-active')).not.toBeInTheDocument();
    const [[url]] = callsTo('DELETE') as [string, RequestInit][];
    expect(url).toMatch(/\/price-alerts\/rule-active$/);

    resolveDelete(new Response(null, { status: 204 }));
    expect(await screen.findByText('No price alerts yet')).toBeInTheDocument();
  });

  it('restores the rule and shows an error when the delete fails', async () => {
    mockApi({ list: () => json([RULES[0]]), remove: () => json({ message: 'Delete failed' }, 500) });
    renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete XLM above 0.15' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
    expect(screen.getByTestId('price-alert-rule-active')).toBeInTheDocument();
  });
});
