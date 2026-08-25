import {
  DEFAULT_DRAFT_MAX_AGE_MS,
  evaluateContributionDraft,
  isContributionDraftStale,
  parseContributionDraft,
} from '../contribution-drafts';
import type { ContributionDraft } from '../contribution-drafts';

/**
 * Helpers
 */
const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
};

const validDraft = (): ContributionDraft => ({
  projectId: 42,
  amount: '25.5',
  // One minute ago so the default fixture never trips staleness checks.
  savedAt: new Date(Date.now() - 60 * 1000).toISOString(),
});

const alwaysValidAmount = (): string | null => null;

/**
 * parseContributionDraft accepts a well-formed draft and normalizes the
 * amount so downstream validation sees a canonical value.
 */
export function testParseContributionDraftAcceptsValidDraft(): boolean {
  try {
    const parsed = parseContributionDraft({
      projectId: 7,
      amount: ' 10.25 ',
      savedAt: new Date('2026-02-03T04:05:06.000Z').toISOString(),
    });
    assert(parsed !== null, 'expected a valid draft to parse');
    assert(parsed?.projectId === 7, 'projectId should be preserved');
    assert(parsed?.amount === '10.25', 'amount should be trimmed');
    assert(parsed?.savedAt === '2026-02-03T04:05:06.000Z', 'savedAt should be preserved verbatim');
    return true;
  } catch (error) {
    console.error('✗ testParseContributionDraftAcceptsValidDraft:', error);
    return false;
  }
}

/**
 * Corrupted or tampered persistence payloads must parse to `null` instead of
 * leaking garbage into the contribution form.
 */
export function testParseContributionDraftRejectsMalformedInput(): boolean {
  try {
    const badSavedAt = { ...validDraft(), savedAt: 'not-a-date' };
    const zeroProjectId = { ...validDraft(), projectId: 0 };
    const negativeProjectId = { ...validDraft(), projectId: -3 };

    assert(parseContributionDraft(null) === null, 'null payload rejected');
    assert(parseContributionDraft(undefined) === null, 'undefined payload rejected');
    assert(parseContributionDraft('draft') === null, 'string payload rejected');
    assert(parseContributionDraft([validDraft()]) === null, 'array payload rejected');
    assert(parseContributionDraft({}) === null, 'empty object rejected');

    const cases: Record<string, unknown>[] = [
      { amount: '10' }, // missing projectId + savedAt
      { projectId: 1 }, // missing amount + savedAt
      { ...validDraft(), amount: '' }, // empty amount
      { ...validDraft(), amount: '   ' }, // whitespace-only amount
      { ...validDraft(), amount: 10 }, // non-string amount
      { ...validDraft(), projectId: '42' }, // non-numeric projectId
      zeroProjectId,
      negativeProjectId,
      { ...badSavedAt },
      { ...validDraft(), savedAt: 12345 }, // non-string savedAt
    ];

    for (const [index, payload] of cases.entries()) {
      assert(
        parseContributionDraft(payload) === null,
        `malformed case #${index} should be rejected`,
      );
    }
    return true;
  } catch (error) {
    console.error('✗ testParseContributionDraftRejectsMalformedInput:', error);
    return false;
  }
}

/**
 * A draft becomes stale strictly after maxAgeMs has elapsed since savedAt.
 */
export function testIsContributionDraftStaleBoundaries(): boolean {
  try {
    const savedAtMs = new Date('2026-01-01T00:00:00.000Z').getTime();
    const fresh = { ...validDraft(), savedAt: new Date(savedAtMs).toISOString() };
    const day = 24 * 60 * 60 * 1000;

    assert(
      !isContributionDraftStale(fresh, savedAtMs + DEFAULT_DRAFT_MAX_AGE_MS),
      'draft exactly at max age is not yet stale',
    );
    assert(
      isContributionDraftStale(fresh, savedAtMs + DEFAULT_DRAFT_MAX_AGE_MS + 1),
      'draft one ms past max age is stale',
    );
    assert(!isContributionDraftStale(fresh, savedAtMs + day), 'recent draft is not stale');

    const undated = { ...fresh, savedAt: 'garbage' };
    assert(isContributionDraftStale(undated, savedAtMs), 'unreadable timestamp counts as stale');
    return true;
  } catch (error) {
    console.error('✗ testIsContributionDraftStaleBoundaries:', error);
    return false;
  }
}

/**
 * A fresh draft with a valid amount on a configured network is resumable.
 */
export function testEvaluateResumableDraft(): boolean {
  try {
    const now = Date.now();
    const evaluation = evaluateContributionDraft(validDraft(), {
      isTestnetConfigReady: true,
      isValidAmount: alwaysValidAmount,
      now,
    });

    assert(evaluation.resumable === true, 'expected draft to be resumable');
    assert(evaluation.blocker === null, 'resumable drafts must have no blocker');
    return true;
  } catch (error) {
    console.error('✗ testEvaluateResumableDraft:', error);
    return false;
  }
}

/**
 * Blocker precedence: environment problems win over content problems, and
 * every blocked draft exposes a reason the UI can act on.
 */
export function testEvaluateBlockersAndPrecedence(): boolean {
  try {
    const now = Date.now();
    const deps = {
      isTestnetConfigReady: true,
      isValidAmount: alwaysValidAmount,
      now,
    };

    // Testnet config missing — even a perfect draft cannot resume.
    const configMissing = evaluateContributionDraft(validDraft(), {
      ...deps,
      isTestnetConfigReady: false,
      isValidAmount: () => 'broken too',
    });
    assert(
      configMissing.blocker === 'testnet_config_missing',
      'missing testnet config must win over other blockers',
    );

    // Stale drafts are never resumable, even with a valid amount.
    const staleDeps = { ...deps, isValidAmount: alwaysValidAmount };
    const stale = evaluateContributionDraft(validDraft(), {
      ...staleDeps,
      now: now + DEFAULT_DRAFT_MAX_AGE_MS + 1,
    });
    assert(stale.blocker === 'stale', 'expired draft must report staleness');

    // Invalid amounts are blocked so the user is never prefilled with junk.
    const invalidAmount = evaluateContributionDraft(validDraft(), {
      ...deps,
      isValidAmount: () => 'Minimum contribution is 0.01 XLM.',
    });
    assert(invalidAmount.blocker === 'invalid_amount', 'invalid amount must block resume');

    // Custom maxAge is respected for staleness checks.
    const customAge = evaluateContributionDraft(validDraft(), {
      ...deps,
      now: now + 1000,
      maxAgeMs: 999,
    });
    assert(customAge.blocker === 'stale', 'custom maxAgeMs must be honored');

    return true;
  } catch (error) {
    console.error('✗ testEvaluateBlockersAndPrecedence:', error);
    return false;
  }
}

export function runContributionDraftTests(): boolean {
  console.log('=== Contribution Draft Tests ===\n');

  console.log('1. Parsing valid drafts...');
  const t1 = testParseContributionDraftAcceptsValidDraft();
  console.log(t1 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('2. Rejecting malformed drafts...');
  const t2 = testParseContributionDraftRejectsMalformedInput();
  console.log(t2 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('3. Staleness boundaries...');
  const t3 = testIsContributionDraftStaleBoundaries();
  console.log(t3 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('4. Resumable evaluation...');
  const t4 = testEvaluateResumableDraft();
  console.log(t4 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('5. Blockers and precedence...');
  const t5 = testEvaluateBlockersAndPrecedence();
  console.log(t5 ? '✓ PASS\n' : '✗ FAIL\n');

  const allPassed = t1 && t2 && t3 && t4 && t5;
  console.log(
    allPassed
      ? '=== ALL CONTRIBUTION DRAFT TESTS PASSED ==='
      : '=== SOME CONTRIBUTION DRAFT TESTS FAILED ===',
  );
  return allPassed;
}
