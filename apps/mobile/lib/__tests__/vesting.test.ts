import { apiClient } from '../api-client';
import {
  ClaimOutcome,
  STROOPS_PER_UNIT,
  TreasuryStream,
  VestingSchedule,
  claim,
  claimReceiptParams,
  claimReceiptRoute,
  claimStepUpPrompt,
  claimTxType,
  describeMilestoneCondition,
  formatClaimAmount,
  formatClaimAmountWithAsset,
  parseStroops,
  summarizeTreasury,
  summarizeVesting,
  toUnixSeconds,
  treasuryApi,
  vestedFraction,
  vestingApi,
  vestingEndsAt,
  vestingStateLabel,
} from '../vesting';

jest.mock('../api-client', () => ({
  apiClient: { get: jest.fn() },
}));

jest.mock('../biometric-lock', () => ({
  requireBiometricConfirmation: jest.fn(),
}));

const mockedGet = apiClient.get as unknown as jest.Mock;

/** 2026-09-28T12:00:00Z, in the seconds unit the contracts use. */
const NOW_SECONDS = 1_790_673_600;
const NOW = new Date(NOW_SECONDS * 1000);

const DAY = 24 * 60 * 60;

function schedule(overrides: Partial<VestingSchedule> = {}): VestingSchedule {
  return {
    beneficiary: 'GBENEFICIARY',
    totalAmount: '1000000000', // 100 XLM
    claimedAmount: '250000000', // 25 XLM
    claimableAmount: '100000000', // 10 XLM
    remainingAmount: '750000000',
    startTime: NOW_SECONDS - 10 * DAY,
    duration: 40 * DAY,
    hasMilestoneRequirement: false,
    vaultContract: null,
    projectId: null,
    milestoneId: null,
    ...overrides,
  };
}

function stream(overrides: Partial<TreasuryStream> = {}): TreasuryStream {
  return {
    beneficiary: 'GBENEFICIARY',
    totalAmount: '500000000',
    claimedAmount: '0',
    unlockedAmount: '125000000',
    remainingAmount: '500000000',
    startTime: NOW_SECONDS - 5 * DAY,
    duration: 20 * DAY,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('amount handling', () => {
  it('parses stroop strings, numbers and junk', () => {
    expect(parseStroops('100000000')).toBe(100000000);
    expect(parseStroops(42)).toBe(42);
    expect(parseStroops('not a number')).toBe(0);
    expect(parseStroops(null)).toBe(0);
    expect(parseStroops(undefined)).toBe(0);
  });

  it('converts stroops to display units, trimming trailing zeros', () => {
    expect(STROOPS_PER_UNIT).toBe(10_000_000);
    expect(formatClaimAmount('100000000')).toBe('10');
    expect(formatClaimAmount('12500000')).toBe('1.25');
    expect(formatClaimAmount('1')).toBe('0.0000001');
    expect(formatClaimAmount('0')).toBe('0');
  });

  it('groups large amounts', () => {
    expect(formatClaimAmount(`${1234 * STROOPS_PER_UNIT}`)).toBe('1,234');
  });

  it('appends the asset code', () => {
    expect(formatClaimAmountWithAsset('100000000')).toBe('10 XLM');
    expect(formatClaimAmountWithAsset('100000000', 'USDC')).toBe('10 USDC');
  });
});

describe('vesting schedule math', () => {
  it('converts a Date to unix seconds', () => {
    expect(toUnixSeconds(NOW)).toBe(NOW_SECONDS);
  });

  it('computes the vested fraction and clamps at both ends', () => {
    expect(vestedFraction({ startTime: NOW_SECONDS - 20 * DAY, duration: 40 * DAY }, NOW_SECONDS)).toBe(
      0.5,
    );
    expect(vestedFraction({ startTime: NOW_SECONDS + DAY, duration: 40 * DAY }, NOW_SECONDS)).toBe(0);
    expect(vestedFraction({ startTime: NOW_SECONDS - 100 * DAY, duration: 40 * DAY }, NOW_SECONDS)).toBe(1);
  });

  it('treats a zero-duration schedule as fully vested', () => {
    expect(vestedFraction({ startTime: NOW_SECONDS, duration: 0 }, NOW_SECONDS)).toBe(1);
  });

  it('reports when vesting ends', () => {
    expect(vestingEndsAt({ startTime: NOW_SECONDS - 10 * DAY, duration: 40 * DAY })).toBe(
      new Date((NOW_SECONDS + 30 * DAY) * 1000).toISOString(),
    );
  });

  it('describes an unmet milestone condition', () => {
    expect(describeMilestoneCondition(schedule())).toBeNull();
    expect(
      describeMilestoneCondition(
        schedule({
          hasMilestoneRequirement: true,
          vaultContract: 'CVAULT',
          projectId: 42,
          milestoneId: 3,
        }),
      ),
    ).toBe('Claiming unlocks once milestone #3 of project #42 is approved in the crowdfund vault.');
  });

  it('describes a milestone condition with unknown ids', () => {
    expect(describeMilestoneCondition(schedule({ hasMilestoneRequirement: true }))).toBe(
      'Claiming unlocks once the linked milestone of the crowdfund vault is approved in the crowdfund vault.',
    );
  });
});

describe('summarizeVesting', () => {
  it('is claimable when there is something to claim', () => {
    const summary = summarizeVesting(schedule(), NOW_SECONDS);
    expect(summary.state).toBe('claimable');
    expect(summary.claimable).toBe(100000000);
    expect(summary.canClaim).toBe(true);
    expect(summary.reason).toBeNull();
    expect(vestingStateLabel('claimable')).toBe('Claimable');
  });

  it('explains a fully claimed schedule instead of showing a dead button', () => {
    const summary = summarizeVesting(
      schedule({ claimableAmount: '0', remainingAmount: '0' }),
      NOW_SECONDS,
    );
    expect(summary.state).toBe('fully-claimed');
    expect(summary.canClaim).toBe(false);
    expect(summary.reason).toMatch(/already been claimed/);
    expect(vestingStateLabel('fully-claimed')).toBe('Fully claimed');
  });

  it('explains a schedule that has not started yet', () => {
    const summary = summarizeVesting(
      schedule({ claimableAmount: '0', startTime: NOW_SECONDS + 3 * DAY }),
      NOW_SECONDS,
    );
    expect(summary.state).toBe('not-started');
    expect(summary.canClaim).toBe(false);
    expect(summary.reason).toMatch(/Vesting starts on/);
    expect(vestingStateLabel('not-started')).toBe('Not started');
  });

  it('explains a milestone-gated schedule', () => {
    const summary = summarizeVesting(
      schedule({
        claimableAmount: '0',
        hasMilestoneRequirement: true,
        projectId: 7,
        milestoneId: 1,
      }),
      NOW_SECONDS,
    );
    expect(summary.state).toBe('milestone-locked');
    expect(summary.canClaim).toBe(false);
    expect(summary.reason).toBe(
      'Claiming unlocks once milestone #1 of project #7 is approved in the crowdfund vault.',
    );
    expect(vestingStateLabel('milestone-locked')).toBe('Milestone pending');
  });

  it('falls back to a refresh hint when nothing is unlocked yet', () => {
    const summary = summarizeVesting(
      schedule({ claimableAmount: '0', startTime: NOW_SECONDS - DAY, duration: 100 * DAY }),
      NOW_SECONDS,
    );
    expect(summary.state).toBe('unavailable');
    expect(summary.reason).toMatch(/Pull to refresh/);
    expect(vestingStateLabel('unavailable')).toBe('Unavailable');
  });

  it('prefers the fully-claimed message over the not-started one', () => {
    const summary = summarizeVesting(
      schedule({ claimableAmount: '0', remainingAmount: '0', startTime: NOW_SECONDS + DAY }),
      NOW_SECONDS,
    );
    expect(summary.state).toBe('fully-claimed');
  });
});

describe('summarizeTreasury', () => {
  it('uses the unlocked amount as the claimable amount', () => {
    const summary = summarizeTreasury(stream(), NOW_SECONDS);
    expect(summary.state).toBe('claimable');
    expect(summary.claimable).toBe(125000000);
  });

  it('explains an empty stream', () => {
    const summary = summarizeTreasury(stream({ unlockedAmount: '0' }), NOW_SECONDS);
    expect(summary.canClaim).toBe(false);
    expect(summary.reason).toMatch(/Pull to refresh/);
  });
});

describe('claim reads', () => {
  it('encodes the beneficiary in the vesting schedule path', async () => {
    mockedGet.mockResolvedValue({ success: true, data: schedule() });
    await vestingApi.getSchedule('G/BENEFICIARY');
    expect(mockedGet).toHaveBeenCalledWith(
      '/vesting-wallet/vesting/G%2FBENEFICIARY',
    );
  });

  it('reads the read-only claimable preview', async () => {
    mockedGet.mockResolvedValue({ success: true, data: {} });
    await vestingApi.getClaimablePreview('GBENEFICIARY');
    expect(mockedGet).toHaveBeenCalledWith('/vesting-wallet/vesting/GBENEFICIARY/claimable');
  });

  it('reads the treasury stream', async () => {
    mockedGet.mockResolvedValue({ success: true, data: stream() });
    await treasuryApi.getStream('GBENEFICIARY');
    expect(mockedGet).toHaveBeenCalledWith('/treasury/streams/GBENEFICIARY');
  });
});

describe('claim', () => {
  function request(overrides: Partial<Parameters<typeof claim>[0]> = {}) {
    return {
      source: 'vesting' as const,
      beneficiary: 'GBENEFICIARY',
      contractId: 'CVESTING',
      amountLabel: '10 XLM',
      adapter: { signXdr: jest.fn().mockResolvedValue({ status: 'success', txHash: 'abc123' }) },
      buildClaimXdr: jest.fn().mockResolvedValue('AAAA'),
      requireStepUp: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
  }

  it('steps up, builds and signs, then reports success', async () => {
    const req = request();
    const outcome = await claim(req);

    expect(req.requireStepUp).toHaveBeenCalledWith('Confirm claiming 10 XLM from your vesting schedule');
    expect(req.buildClaimXdr).toHaveBeenCalledWith({
      source: 'vesting',
      beneficiary: 'GBENEFICIARY',
      contractId: 'CVESTING',
    });
    expect(req.adapter.signXdr).toHaveBeenCalledWith('AAAA');
    expect(outcome).toEqual({ kind: 'success', txHash: 'abc123' });
  });

  it('does not build or sign when the biometric step-up is declined', async () => {
    const req = request({ requireStepUp: jest.fn().mockResolvedValue(false) });
    const outcome = await claim(req);

    expect(outcome.kind).toBe('cancelled');
    expect(req.buildClaimXdr).not.toHaveBeenCalled();
    expect(req.adapter.signXdr).not.toHaveBeenCalled();
  });

  it('treats a step-up that throws as a decline', async () => {
    const req = request({ requireStepUp: jest.fn().mockRejectedValue(new Error('no sensor')) });
    await expect(claim(req)).resolves.toMatchObject({ kind: 'cancelled' });
  });

  it('surfaces a build failure without touching the wallet', async () => {
    const req = request({
      buildClaimXdr: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
    });
    const outcome = await claim(req);

    expect(outcome).toEqual({ kind: 'failed', message: 'RPC unavailable' });
    expect(req.adapter.signXdr).not.toHaveBeenCalled();
  });

  it('maps a deep-link wallet pending result', async () => {
    const req = request({
      adapter: { signXdr: jest.fn().mockResolvedValue({ status: 'pending' }) },
    });
    await expect(claim(req)).resolves.toEqual({ kind: 'pending' });
  });

  it('maps a wallet rejection', async () => {
    const req = request({
      adapter: {
        signXdr: jest.fn().mockResolvedValue({ status: 'rejected', error: { message: 'User said no' } }),
      },
    });
    await expect(claim(req)).resolves.toEqual({ kind: 'rejected', message: 'User said no' });
  });

  it('maps a wallet failure with and without a message', async () => {
    const withMessage = request({
      adapter: {
        signXdr: jest.fn().mockResolvedValue({ status: 'failed', error: { message: 'No wallet app' } }),
      },
    });
    await expect(claim(withMessage)).resolves.toEqual({ kind: 'failed', message: 'No wallet app' });

    const withoutMessage = request({
      adapter: { signXdr: jest.fn().mockResolvedValue({ status: 'failed' }) },
    });
    await expect(claim(withoutMessage)).resolves.toEqual({
      kind: 'failed',
      message: 'The wallet could not sign the claim.',
    });
  });

  it('labels the step-up prompt and receipt type per source', () => {
    expect(claimStepUpPrompt('treasury', '5 XLM')).toBe(
      'Confirm claiming 5 XLM from your treasury stream',
    );
    expect(claimTxType('vesting')).toBe('Vesting claim');
    expect(claimTxType('treasury')).toBe('Treasury claim');
  });
});

describe('claim receipts', () => {
  const context = { source: 'vesting' as const, amountLabel: '10 XLM', now: () => NOW };

  it('builds receipt params for a confirmed claim', () => {
    const params = claimReceiptParams({ kind: 'success', txHash: 'abc123' }, context);
    expect(params).toEqual({
      status: 'success',
      timestamp: NOW.toISOString(),
      amount: '10 XLM',
      txType: 'Vesting claim',
      txHash: 'abc123',
    });
  });

  it('marks a deep-link wallet claim as pending', () => {
    const params = claimReceiptParams({ kind: 'pending' }, context);
    expect(params).toEqual({
      status: 'pending',
      timestamp: NOW.toISOString(),
      amount: '10 XLM',
      txType: 'Vesting claim',
    });
  });

  it('carries the failure detail onto the receipt', () => {
    const outcome: ClaimOutcome = { kind: 'failed', message: 'RPC unavailable' };
    expect(claimReceiptParams(outcome, { source: 'treasury', amountLabel: '5 XLM', now: () => NOW })).toEqual({
      status: 'failed',
      timestamp: NOW.toISOString(),
      amount: '5 XLM',
      txType: 'Treasury claim',
      errorDetail: 'RPC unavailable',
    });
  });

  it('produces no receipt for a cancelled claim', () => {
    const outcome: ClaimOutcome = { kind: 'cancelled', message: 'Claim cancelled before signing.' };
    expect(claimReceiptParams(outcome, context)).toBeNull();
    expect(claimReceiptRoute(outcome, context)).toBeNull();
  });

  it('routes to the existing transaction receipt screen', () => {
    expect(claimReceiptRoute({ kind: 'success', txHash: 'abc123' }, context)).toEqual({
      pathname: '/transaction-receipt',
      params: {
        status: 'success',
        timestamp: NOW.toISOString(),
        amount: '10 XLM',
        txType: 'Vesting claim',
        txHash: 'abc123',
      },
    });
  });
});
