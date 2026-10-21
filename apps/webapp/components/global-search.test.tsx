import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from './global-search';
import { dispatchRunSavedSearch } from '@/lib/saved-search-service';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.includes('/saved-searches')) {
      const body = JSON.parse(String(init.body));
      return json({ id: 's1', userId: 'u', isSubscribed: false, ...body }, 201);
    }
    if (url.includes('/search/projects')) {
      return json({ items: [{ projectId: 1, name: 'Lumen', ownerPublicKey: 'GABCDEFGH', status: 'ok', score: 1 }], total: 1 });
    }
    if (url.includes('/search/assets')) return json({ assets: [], hasMore: false });
    if (url.includes('/search/ecosystem')) return json({ items: [] });
    return json({ projects: [], assets: [], ecosystem: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const searchUrls = () =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/search/projects'));

describe('GlobalSearch saved searches', () => {
  it('saves the current query under the chosen name', async () => {
    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole('combobox'), '  lumen ');
    await userEvent.click(await screen.findByRole('button', { name: /save this search/i }));

    const name = screen.getByLabelText('Saved search name');
    expect(name).toHaveValue('lumen');
    await userEvent.clear(name);
    await userEvent.type(name, 'My lumen search');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Saved as “My lumen search”/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u]) => String(u).includes('/saved-searches'))!;
    expect(JSON.parse(String(post[1].body))).toEqual({
      name: 'My lumen search',
      domain: 'projects',
      filters: { q: 'lumen' },
    });
  });

  it('shows the API error when saving fails', async () => {
    render(<GlobalSearch />);
    await userEvent.type(screen.getByRole('combobox'), 'lumen');
    await userEvent.click(await screen.findByRole('button', { name: /save this search/i }));
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/saved-searches') ? json({ message: 'Unauthorized' }, 401) : json({ items: [] }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to use saved searches.');
  });

  it('restores and runs a saved search exactly', async () => {
    render(<GlobalSearch />);
    act(() => dispatchRunSavedSearch({ q: 'Stellar DeFi' }));

    expect(screen.getByRole('combobox')).toHaveValue('Stellar DeFi');
    await waitFor(() => expect(searchUrls()).toHaveLength(1));
    expect(new URL(searchUrls()[0]).searchParams.get('q')).toBe('Stellar DeFi');
    expect(await screen.findByText('Lumen')).toBeInTheDocument();
  });
});
