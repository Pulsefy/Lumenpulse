import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsCenter } from './notifications-center';

describe('NotificationsCenter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an empty state when there are no notifications', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    }));

    render(<NotificationsCenter />);

    expect(await screen.findByText(/No updates yet/i)).toBeInTheDocument();
  });

  it('marks a notification as read and keeps the deep link intact', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'notify-1',
              title: 'Grant approved',
              body: 'Your grant proposal moved to the next stage.',
              destination: '/grants/round-42',
              read: false,
              type: 'grant',
              createdAt: '2026-07-27T10:00:00.000Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'notify-1',
          title: 'Grant approved',
          body: 'Your grant proposal moved to the next stage.',
          destination: '/grants/round-42',
          read: true,
          type: 'grant',
          createdAt: '2026-07-27T10:00:00.000Z',
        }),
      }));

    render(<NotificationsCenter />);

    const item = await screen.findByText('Grant approved');
    expect(item).toBeInTheDocument();

    const link = screen.getByRole('link', { name: /view details/i });
    expect(link).toHaveAttribute('href', '/grants/round-42');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /mark as read/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument();
    });
  });
});
