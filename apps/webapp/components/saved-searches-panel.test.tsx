import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SavedSearchesPanel from './saved-searches-panel';
import { RUN_SAVED_SEARCH_EVENT, type RunSavedSearchDetail } from '@/lib/saved-search-service';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const BASE = {
  userId: 'u',
  lastNotifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SEARCHES = [
  { ...BASE, id: 's-proj', name: 'Lumen projects', domain: 'projects', filters: { q: 'lumen' }, isSubscribed: false },
  {
    ...BASE,
    id: 's-news',
    name: 'DeFi news',
    domain: 'news',
    filters: { tag: 'defi', category: 'markets' },
    isSubscribed: true,
  },
];

const fetchMock = vi.fn();

function route(handlers: {
  list?: () => Response;
  update?: (id: string, body: Record<string, unknown>) => Response;
  remove?: (id: string) => Response;
}) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const id = url.match(/\/saved-searches\/([^/?]+)$/)?.[1];
    if (!init.method) return (handlers.list ?? (() => json({ items: SEARCHES, total: 2 })))();
    if (init.method === 'PATCH') return handlers.update!(id!, JSON.parse(String(init.body)));
    if (init.method === 'DELETE') return (handlers.remove ?? (() => new Response(null, { status: 204 })))(id!);
    throw new Error(`unexpected ${init.method} ${url}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  push.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SavedSearchesPanel', () => {
  it('shows the shared skeleton then the list', async () => {
    route({});
    render(<SavedSearchesPanel />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(await screen.findByText('Lumen projects')).toBeInTheDocument();
    expect(screen.getByText('DeFi news')).toBeInTheDocument();
  });

  it('shows the shared empty state', async () => {
    route({ list: () => json({ items: [], total: 0 }) });
    render(<SavedSearchesPanel />);
    expect(await screen.findByText('No saved searches yet')).toBeInTheDocument();
  });

  it('shows the shared error state and retries', async () => {
    let calls = 0;
    route({ list: () => (++calls === 1 ? json({ message: 'boom' }, 500) : json({ items: SEARCHES, total: 2 })) });
    render(<SavedSearchesPanel />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Lumen projects')).toBeInTheDocument();
  });

  it('renames a saved search', async () => {
    route({ update: (id, body) => json({ ...SEARCHES[0], id, name: body.name }) });
    render(<SavedSearchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Lumen projects' }));
    const input = screen.getByLabelText('New name');
    await userEvent.clear(input);
    await userEvent.type(input, '  Lumen weekly  {enter}');
    expect(await screen.findByText('Lumen weekly')).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1].body))).toEqual({ name: 'Lumen weekly' });
  });

  it('rejects an empty name without calling the API', async () => {
    route({});
    render(<SavedSearchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Lumen projects' }));
    await userEvent.clear(screen.getByLabelText('New name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('re-runs a navbar search by handing its exact filters to the global search', async () => {
    route({});
    const received: RunSavedSearchDetail[] = [];
    const listener = (e: Event) => received.push((e as CustomEvent<RunSavedSearchDetail>).detail);
    window.addEventListener(RUN_SAVED_SEARCH_EVENT, listener);
    render(<SavedSearchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Run Lumen projects' }));
    window.removeEventListener(RUN_SAVED_SEARCH_EVENT, listener);
    expect(received).toEqual([{ filters: { q: 'lumen' } }]);
    expect(push).not.toHaveBeenCalled();
  });

  it('re-runs other domains on their page with every filter restored', async () => {
    route({});
    render(<SavedSearchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Run DeFi news' }));
    expect(push).toHaveBeenCalledWith('/news?tag=defi&category=markets');
  });

  it('toggles notifications', async () => {
    route({ update: (id, body) => json({ ...SEARCHES[0], id, isSubscribed: body.isSubscribed }) });
    render(<SavedSearchesPanel />);
    const toggle = await screen.findByRole('button', { name: 'Notify me about new results for Lumen projects' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(
      await screen.findByRole('button', { name: 'Stop notifications for Lumen projects' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('deletes only after confirmation', async () => {
    route({});
    render(<SavedSearchesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete DeFi news' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('notifications cancelled');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(screen.getByText('DeFi news')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete DeFi news' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('DeFi news')).not.toBeInTheDocument());
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!;
    expect(del[0]).toMatch(/\/saved-searches\/s-news$/);
  });
});
