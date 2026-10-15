import {
  contributorApi,
  buildRegistryState,
  buildReputationBreakdown,
  tierFromScore,
  getTierColor,
  getVerificationStatusColor,
  getVerificationStatusLabel,
  REPUTATION_TIERS,
  REPUTATION_FACTORS,
  type ContributorProfile,
} from '../contributor';

describe('contributor helpers', () => {
  it('maps each contributor tier to the expected color', () => {
    expect(getTierColor('Core')).toBe('#8b5cf6');
    expect(getTierColor('Architect')).toBe('#3b82f6');
    expect(getTierColor('Builder')).toBe('#10b981');
    expect(getTierColor('Novice')).toBe('#f59e0b');
    expect(getTierColor(undefined)).toBe('#f59e0b');
  });

  it('maps verification states to their colors and labels', () => {
    expect(getVerificationStatusColor('VERIFIED')).toBe('#10b981');
    expect(getVerificationStatusLabel('VERIFIED')).toBe('Verified Contributor');
    expect(getVerificationStatusColor('PENDING')).toBe('#f59e0b');
    expect(getVerificationStatusLabel('PENDING')).toBe('Pending Review');
    expect(getVerificationStatusColor('UNREGISTERED')).toBe('#94a3b8');
    expect(getVerificationStatusLabel('UNREGISTERED')).toBe('Unregistered Identity');
  });

  it('exposes the contributor API methods the profile screen depends on', () => {
    expect(typeof contributorApi.getByAddress).toBe('function');
    expect(typeof contributorApi.getByGithub).toBe('function');
    expect(typeof contributorApi.getReputation).toBe('function');
    expect(typeof contributorApi.getNonce).toBe('function');
    expect(typeof contributorApi.buildRegistration).toBe('function');
    expect(typeof contributorApi.submitRegistration).toBe('function');
    expect(typeof contributorApi.getRegistryState).toBe('function');
  });
});

describe('tierFromScore', () => {
  it('keeps the tier thresholds in sync with the backend contract', () => {
    expect(REPUTATION_TIERS.map((band) => [band.tier, band.minScore])).toEqual([
      ['Novice', 0],
      ['Builder', 10],
      ['Architect', 50],
      ['Core', 100],
    ]);
  });

  it('derives the tier for scores on both sides of every threshold', () => {
    expect(tierFromScore(0)).toBe('Novice');
    expect(tierFromScore(9)).toBe('Novice');
    expect(tierFromScore(10)).toBe('Builder');
    expect(tierFromScore(49)).toBe('Builder');
    expect(tierFromScore(50)).toBe('Architect');
    expect(tierFromScore(99)).toBe('Architect');
    expect(tierFromScore(100)).toBe('Core');
    expect(tierFromScore(5000)).toBe('Core');
  });

  it('falls back to the lowest tier for a non-finite score', () => {
    expect(tierFromScore(Number.NaN)).toBe('Novice');
  });
});

describe('buildReputationBreakdown', () => {
  it('reports the distance and intra-tier progress to the next band', () => {
    const breakdown = buildReputationBreakdown(30);

    expect(breakdown.score).toBe(30);
    expect(breakdown.tier).toBe('Builder');
    expect(breakdown.nextTier).toBe('Architect');
    expect(breakdown.pointsToNextTier).toBe(20);
    // (30 - 10) / (50 - 10) = 50%
    expect(breakdown.progressToNextTier).toBe(50);
    expect(breakdown.factors).toEqual(REPUTATION_FACTORS);
  });

  it('explains the empty-score case as zero progress towards Builder', () => {
    const breakdown = buildReputationBreakdown(0);

    expect(breakdown.tier).toBe('Novice');
    expect(breakdown.nextTier).toBe('Builder');
    expect(breakdown.pointsToNextTier).toBe(10);
    expect(breakdown.progressToNextTier).toBe(0);
    expect(breakdown.bands.map((band) => band.achieved)).toEqual([true, false, false, false]);
  });

  it('caps progress at the top tier', () => {
    const breakdown = buildReputationBreakdown(250);

    expect(breakdown.tier).toBe('Core');
    expect(breakdown.nextTier).toBeNull();
    expect(breakdown.pointsToNextTier).toBe(0);
    expect(breakdown.progressToNextTier).toBe(100);
    expect(breakdown.bands.every((band) => band.achieved)).toBe(true);
  });

  it('treats negative and non-finite scores as zero', () => {
    expect(buildReputationBreakdown(-5).score).toBe(0);
    expect(buildReputationBreakdown(Number.NaN).score).toBe(0);
    expect(buildReputationBreakdown(Number.POSITIVE_INFINITY).score).toBe(0);
  });
});

describe('buildRegistryState', () => {
  const profile: ContributorProfile = {
    address: 'GABC1234567890',
    githubHandle: 'octocat',
    reputationScore: 12,
    tier: 'Builder',
    registeredAt: '2026-01-01T00:00:00.000Z',
  };

  it('reports an address with no registry record as unregistered', () => {
    const state = buildRegistryState('GABC1234567890', null, null);

    expect(state.isRegistered).toBe(false);
    expect(state.status).toBe('UNREGISTERED');
    expect(state.githubHandle).toBeNull();
    expect(state.isGithubLinked).toBe(false);
    expect(state.registeredAt).toBeNull();
    expect(state.reputation.score).toBe(0);
    expect(state.requirements.find((req) => req.id === 'onchain_registry')?.fulfilled).toBe(false);
    expect(state.requirements.find((req) => req.id === 'wallet_linked')?.fulfilled).toBe(true);
  });

  it('prefers the reputation read for the score and fulfils every requirement', () => {
    const state = buildRegistryState('GABC1234567890', profile, {
      address: 'GABC1234567890',
      reputationScore: 42,
      tier: 'Builder',
    });

    expect(state.isRegistered).toBe(true);
    expect(state.status).toBe('VERIFIED');
    expect(state.githubHandle).toBe('octocat');
    expect(state.isGithubLinked).toBe(true);
    expect(state.registeredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(state.reputation.score).toBe(42);
    expect(state.reputation.tier).toBe('Builder');
    expect(state.requirements.every((req) => req.fulfilled)).toBe(true);
  });

  it('falls back to the profile score when the reputation read is unavailable', () => {
    const state = buildRegistryState('GABC1234567890', profile, null);
    expect(state.reputation.score).toBe(12);
    expect(state.reputation.tier).toBe('Builder');
  });

  it('keeps a registered wallet without a handle visible as unlinked', () => {
    const state = buildRegistryState('GABC1234567890', { ...profile, githubHandle: '   ' }, null);

    expect(state.isRegistered).toBe(true);
    expect(state.isGithubLinked).toBe(false);
    expect(state.githubHandle).toBeNull();
    expect(state.requirements.find((req) => req.id === 'github_identity')?.fulfilled).toBe(false);
  });

  it('does not treat a wallet without an address as linked', () => {
    const state = buildRegistryState(null, null, null);
    expect(state.requirements.find((req) => req.id === 'wallet_linked')?.fulfilled).toBe(false);
  });
});
