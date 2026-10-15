import {
  CONTRIBUTIONS_PAUSED_MESSAGE,
  normalizeContributionError,
} from '../contribution-pause';

describe('contribution pause error handling', () => {
  it('maps a backend contractErrorCode to the friendly pause message', () => {
    const result = normalizeContributionError({
      message: 'Simulation failed',
      statusCode: 503,
      details: { contractErrorCode: 19 },
    });

    expect(result).toMatchObject({
      message: CONTRIBUTIONS_PAUSED_MESSAGE,
      error: 'ContributionsPausedError',
      statusCode: 503,
    });
  });

  it('maps a raw Soroban pause diagnostic when a proxy forwards it', () => {
    const result = normalizeContributionError({
      message: 'Simulation failed: HostError: Error(Contract, #19)',
      statusCode: 400,
    });

    expect(result?.message).toBe(CONTRIBUTIONS_PAUSED_MESSAGE);
    expect(result?.error).toBe('ContributionsPausedError');
  });

  it('leaves unrelated contribution errors unchanged', () => {
    const error = { message: 'Insufficient balance', statusCode: 400 };
    expect(normalizeContributionError(error)).toEqual(error);
  });
});
