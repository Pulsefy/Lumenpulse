import {
  DEFAULT_DRAFT_MAX_AGE_MS,
  evaluateContributionDraft,
  isContributionDraftStale,
  parseContributionDraft,
} from '../contribution-drafts';
import type { ContributionDraft } from '../contribution-drafts';

describe('contribution drafts', () => {
  const validDraft = (): ContributionDraft => ({
    projectId: 42,
    amount: '25.5',
    savedAt: new Date(Date.now() - 60 * 1000).toISOString(),
  });

  it('parses a valid contribution draft and trims the amount', () => {
    const parsed = parseContributionDraft({
      projectId: 7,
      amount: ' 10.25 ',
      savedAt: new Date('2026-02-03T04:05:06.000Z').toISOString(),
    });

    expect(parsed).toEqual({
      projectId: 7,
      amount: '10.25',
      savedAt: '2026-02-03T04:05:06.000Z',
    });
  });

  it('rejects malformed draft payloads', () => {
    expect(parseContributionDraft(null)).toBeNull();
    expect(parseContributionDraft(undefined)).toBeNull();
    expect(parseContributionDraft('draft')).toBeNull();
    expect(parseContributionDraft({})).toBeNull();
    expect(parseContributionDraft({ projectId: 1, amount: '', savedAt: '2025-01-01' })).toBeNull();
    expect(parseContributionDraft({ projectId: 0, amount: '10', savedAt: '2025-01-01' })).toBeNull();
  });

  it('marks drafts stale when they exceed the configured age limit', () => {
    const baseMs = new Date('2026-01-01T00:00:00.000Z').getTime();
    const fresh = { ...validDraft(), savedAt: new Date(baseMs).toISOString() };

    expect(isContributionDraftStale(fresh, baseMs + DEFAULT_DRAFT_MAX_AGE_MS)).toBe(false);
    expect(isContributionDraftStale(fresh, baseMs + DEFAULT_DRAFT_MAX_AGE_MS + 1)).toBe(true);
  });

  it('only restores resumable drafts when the environment and amount are valid', () => {
    const now = Date.now();
    const draft = validDraft();

    expect(evaluateContributionDraft(draft, {
      isTestnetConfigReady: true,
      isValidAmount: () => null,
      now,
    })).toEqual({ resumable: true, blocker: null });

    expect(evaluateContributionDraft(draft, {
      isTestnetConfigReady: false,
      isValidAmount: () => 'bad',
      now,
    })).toEqual({ resumable: false, blocker: 'testnet_config_missing' });

    expect(evaluateContributionDraft(draft, {
      isTestnetConfigReady: true,
      isValidAmount: () => 'bad',
      now,
    })).toEqual({ resumable: false, blocker: 'invalid_amount' });
  });
});
