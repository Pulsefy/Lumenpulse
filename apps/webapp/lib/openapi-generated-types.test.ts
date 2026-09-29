import { describe, expect, it } from 'vitest';

import type { components } from '@/generated/openapi-types';

describe('generated OpenAPI types', () => {
  it('exposes the backend watchlist and moderation DTO contracts', () => {
    const watchlistItem: components['schemas']['WatchlistItemResponseDto'] = {
      id: 'item-1',
      userId: 'user-1',
      symbol: 'XLM',
      name: 'Stellar',
      type: 'asset',
      assetIssuer: null,
      imageUrl: null,
      notes: null,
      sortOrder: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };

    const report: components['schemas']['CreateReportDto'] = {
      targetType: 'project',
      targetId: 'project-42',
      reason: 'spam',
      description: 'Suspicious campaign',
    };

    expect(watchlistItem.type).toBe('asset');
    expect(report.reason).toBe('spam');
  });
});
