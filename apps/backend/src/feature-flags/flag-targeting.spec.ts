import { FeatureFlag } from './feature-flag.entity';
import {
  BUCKET_COUNT,
  EMPTY_TARGETING,
  MAX_ROLLOUT_PERCENTAGE,
  bucketFor,
  isTargetingEmpty,
  normalizePrincipalList,
  normalizeRolloutPercentage,
  readTargeting,
  resolveFlag,
  sanitizeTargetingInput,
  snapshotTargeting,
} from './flag-targeting';

const buildFlag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  id: 'flag-id',
  key: 'risky.migration',
  enabled: false,
  rolloutPercentage: null,
  allowList: null,
  denyList: null,
  conditions: null,
  changedBy: null,
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
  ...overrides,
});

/** A deterministic spread of principal ids, so failures are reproducible. */
const PRINCIPALS = Array.from({ length: 500 }, (_, i) => `user-${i}`);

describe('flag targeting', () => {
  describe('bucketFor', () => {
    it('is stable across repeated evaluations of the same principal', () => {
      const first = bucketFor('risky.migration', 'user-1');

      for (let i = 0; i < 1000; i++) {
        expect(bucketFor('risky.migration', 'user-1')).toBe(first);
      }
    });

    it('always lands inside [0, BUCKET_COUNT)', () => {
      for (const principal of PRINCIPALS) {
        const bucket = bucketFor('risky.migration', principal);
        expect(Number.isInteger(bucket)).toBe(true);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(BUCKET_COUNT);
      }
    });

    it('distributes principals roughly evenly across the hash space', () => {
      // A hash that clumped would make a "5% rollout" serve 5% of one
      // alphabetical slice and nothing else.
      const deciles = new Array(10).fill(0) as number[];
      for (const principal of PRINCIPALS) {
        deciles[Math.floor(bucketFor('risky.migration', principal) / 1000)]++;
      }

      // 500 principals / 10 buckets = 50 expected; allow a wide band so the
      // assertion is about the shape of the distribution, not one particular
      // hash's exact counts.
      for (const count of deciles) {
        expect(count).toBeGreaterThan(15);
        expect(count).toBeLessThan(90);
      }
    });

    it('buckets different flags independently', () => {
      // Independent buckets mean a user unlucky in one canary is not also
      // unlucky in every other one.
      const flagA = PRINCIPALS.map((p) => bucketFor('flag.a', p));
      const flagB = PRINCIPALS.map((p) => bucketFor('flag.b', p));
      expect(flagA).not.toEqual(flagB);
    });

    it('is unaffected by surrounding whitespace in the principal id', () => {
      expect(
        resolveFlag(buildFlag({ rolloutPercentage: 100 }), ' user-1 '),
      ).toEqual(resolveFlag(buildFlag({ rolloutPercentage: 100 }), 'user-1'));
    });
  });

  describe('resolveFlag precedence', () => {
    it('reports flag_not_found and defaults to off for an unknown key', () => {
      expect(resolveFlag(null, 'user-1')).toEqual({
        enabled: false,
        reason: 'flag_not_found',
        bucket: null,
      });
      expect(resolveFlag(undefined, 'user-1').reason).toBe('flag_not_found');
    });

    it('falls back to the stored state when no targeting is configured', () => {
      expect(resolveFlag(buildFlag({ enabled: true }), 'user-1')).toEqual({
        enabled: true,
        reason: 'default_state',
        bucket: null,
      });
      expect(resolveFlag(buildFlag({ enabled: false }), 'user-1')).toEqual({
        enabled: false,
        reason: 'default_state',
        bucket: null,
      });
    });

    it('includes a principal inside the rollout bucket', () => {
      const flag = buildFlag({ rolloutPercentage: 100 });
      expect(resolveFlag(flag, 'user-1')).toEqual({
        enabled: true,
        reason: 'percentage_included',
        bucket: bucketFor(flag.key, 'user-1'),
      });
    });

    it('excludes every principal at 0%', () => {
      for (const principal of PRINCIPALS) {
        expect(
          resolveFlag(buildFlag({ rolloutPercentage: 0 }), principal),
        ).toEqual({
          enabled: false,
          reason: 'percentage_excluded',
          bucket: expect.any(Number),
        });
      }
    });

    it('includes every principal at 100%', () => {
      const flag = buildFlag({ rolloutPercentage: MAX_ROLLOUT_PERCENTAGE });
      for (const principal of PRINCIPALS) {
        expect(resolveFlag(flag, principal).enabled).toBe(true);
      }
    });

    it('lets the percentage decide even when the stored state is off', () => {
      // This is the staged-rollout case: enabled=false, rollout=5 serves 5%.
      const flag = buildFlag({ enabled: false, rolloutPercentage: 100 });
      expect(resolveFlag(flag, 'user-1').enabled).toBe(true);
    });

    it('lets the percentage decide even when the stored state is on', () => {
      // ...and the kill switch: enabled=true, rollout=0 must serve nobody.
      const flag = buildFlag({ enabled: true, rolloutPercentage: 0 });
      expect(resolveFlag(flag, 'user-1').enabled).toBe(false);
    });

    it('overrides percentage targeting with the allow list', () => {
      const flag = buildFlag({
        rolloutPercentage: 0,
        allowList: ['user-1'],
      });
      expect(resolveFlag(flag, 'user-1')).toEqual({
        enabled: true,
        reason: 'allow_list',
        bucket: null,
      });
      // And the rest of the population is unaffected.
      expect(resolveFlag(flag, 'user-2').reason).toBe('percentage_excluded');
    });

    it('overrides percentage targeting with the deny list', () => {
      const flag = buildFlag({
        rolloutPercentage: 100,
        denyList: ['user-1'],
      });
      expect(resolveFlag(flag, 'user-1')).toEqual({
        enabled: false,
        reason: 'deny_list',
        bucket: null,
      });
      expect(resolveFlag(flag, 'user-2').enabled).toBe(true);
    });

    it('lets deny win when a principal is on both lists', () => {
      const flag = buildFlag({
        enabled: false,
        allowList: ['user-1'],
        denyList: ['user-1'],
      });
      expect(resolveFlag(flag, 'user-1').reason).toBe('deny_list');
    });

    it('does not apply list targeting to an anonymous caller', () => {
      const flag = buildFlag({ allowList: ['user-1'], denyList: ['user-1'] });
      // An empty/blank principal matches nothing, and with no percentage
      // configured there is no bucket to compute, so the stored state applies
      // rather than an accidental allow.
      expect(resolveFlag(flag, null).reason).toBe('default_state');
      expect(resolveFlag(flag, '   ').reason).toBe('default_state');
      expect(resolveFlag(flag, undefined).reason).toBe('default_state');
    });

    it('reports no_principal when a rollout is configured but no principal is given', () => {
      const flag = buildFlag({ enabled: true, rolloutPercentage: 50 });
      expect(resolveFlag(flag, null)).toEqual({
        enabled: true,
        reason: 'no_principal',
        bucket: null,
      });
    });
  });

  describe('bucketing stability across repeated evaluations', () => {
    it('returns an identical result for the same principal every time', () => {
      const flag = buildFlag({ rolloutPercentage: 37 });

      const first = resolveFlag(flag, 'user-42');
      for (let i = 0; i < 500; i++) {
        expect(resolveFlag(flag, 'user-42')).toEqual(first);
      }
    });

    it('produces the same result from a freshly built flag object', () => {
      // Guards against a bucket derived from object identity or a counter
      // rather than from the (flagKey, principalId) pair.
      const first = resolveFlag(
        buildFlag({ rolloutPercentage: 37 }),
        'user-42',
      );

      const rebuilt = resolveFlag(
        buildFlag({ rolloutPercentage: 37 }),
        'user-42',
      );
      expect(rebuilt).toEqual(first);
    });

    it('never drops a principal as the rollout is widened', () => {
      // The property the issue asks for: a user must not flip between states
      // while a percentage rollout is ramped up. Widening can only ever add
      // principals to the included set, never remove one.
      const includedAt = (percentage: number) =>
        new Set(
          PRINCIPALS.filter(
            (principal) =>
              resolveFlag(
                buildFlag({ rolloutPercentage: percentage }),
                principal,
              ).enabled,
          ),
        );

      let previous = includedAt(0);
      expect(previous.size).toBe(0);

      for (let percentage = 1; percentage <= 100; percentage++) {
        const current = includedAt(percentage);
        for (const principal of previous) {
          expect(current.has(principal)).toBe(true);
        }
        previous = current;
      }

      expect(previous.size).toBe(PRINCIPALS.length);
    });

    it('never includes a principal whose bucket is outside the threshold', () => {
      for (const percentage of [1, 5, 25, 50, 99]) {
        const flag = buildFlag({ rolloutPercentage: percentage });
        for (const principal of PRINCIPALS) {
          const { enabled, bucket } = resolveFlag(flag, principal);
          expect(enabled).toBe(bucket !== null && bucket < percentage * 100);
        }
      }
    });

    it('honours the deny list consistently across repeated evaluations', () => {
      const flag = buildFlag({
        rolloutPercentage: 100,
        denyList: ['user-7'],
      });
      for (let i = 0; i < 100; i++) {
        expect(resolveFlag(flag, 'user-7').enabled).toBe(false);
      }
    });
  });

  describe('rollout distribution', () => {
    it('serves roughly the requested share of principals', () => {
      for (const percentage of [5, 25, 50]) {
        const flag = buildFlag({ rolloutPercentage: percentage });
        const served = PRINCIPALS.filter(
          (principal) => resolveFlag(flag, principal).enabled,
        ).length;
        const actual = (served / PRINCIPALS.length) * 100;

        // Loose bounds: this asserts the rollout is honest about its size,
        // not that a specific hash hits an exact number.
        expect(actual).toBeGreaterThan(percentage - 6);
        expect(actual).toBeLessThan(percentage + 6);
      }
    });

    it('increases monotonically as the percentage is raised', () => {
      const servedAt = (percentage: number) =>
        PRINCIPALS.filter(
          (principal) =>
            resolveFlag(buildFlag({ rolloutPercentage: percentage }), principal)
              .enabled,
        ).length;

      let previous = servedAt(0);
      for (const percentage of [10, 25, 50, 75, 100]) {
        const current = servedAt(percentage);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    });
  });

  describe('normalization', () => {
    it('coerces a malformed list to empty rather than throwing', () => {
      expect(normalizePrincipalList(null)).toEqual([]);
      expect(normalizePrincipalList(undefined)).toEqual([]);
      expect(normalizePrincipalList('user-1')).toEqual([]);
      expect(normalizePrincipalList({ '0': 'user-1' })).toEqual([]);
      expect(normalizePrincipalList(['user-1', 42, null, 'user-2'])).toEqual([
        'user-1',
        'user-2',
      ]);
    });

    it('rejects an out-of-range or non-finite rollout percentage', () => {
      // Failing towards "no rollout" means a bad row degrades to plain on/off
      // instead of accidentally serving everyone.
      expect(normalizeRolloutPercentage(-1)).toBeNull();
      expect(normalizeRolloutPercentage(101)).toBeNull();
      expect(normalizeRolloutPercentage(Number.NaN)).toBeNull();
      expect(normalizeRolloutPercentage(Number.POSITIVE_INFINITY)).toBeNull();
      expect(normalizeRolloutPercentage('50')).toBeNull();
      expect(normalizeRolloutPercentage(null)).toBeNull();
    });

    it('rounds a fractional rollout percentage', () => {
      expect(normalizeRolloutPercentage(5.4)).toBe(5);
      expect(normalizeRolloutPercentage(5.6)).toBe(6);
    });

    it('evaluates a malformed rollout as plain on/off instead of throwing', () => {
      const flag = buildFlag({
        enabled: true,
        rolloutPercentage: 5000 as unknown as number,
        allowList: 'user-1' as unknown as string[],
      });
      expect(resolveFlag(flag, 'user-1')).toEqual({
        enabled: true,
        reason: 'default_state',
        bucket: null,
      });
    });

    it('reads a fully-populated flag row', () => {
      const flag = buildFlag({
        rolloutPercentage: 25,
        allowList: ['a'],
        denyList: ['b'],
      });
      expect(readTargeting(flag)).toEqual({
        rolloutPercentage: 25,
        allowList: ['a'],
        denyList: ['b'],
      });
      expect(isTargetingEmpty(readTargeting(flag))).toBe(false);
    });

    it('treats an untargeted flag as empty targeting', () => {
      expect(isTargetingEmpty(readTargeting(buildFlag()))).toBe(true);
      expect(isTargetingEmpty(EMPTY_TARGETING)).toBe(true);
    });

    it('sanitizes caller-supplied targeting', () => {
      expect(sanitizeTargetingInput(undefined)).toEqual({
        rolloutPercentage: null,
        allowList: [],
        denyList: [],
      });
      expect(
        sanitizeTargetingInput({
          rolloutPercentage: 10,
          allowList: ['a', 7 as unknown as string],
          denyList: null,
        }),
      ).toEqual({ rolloutPercentage: 10, allowList: ['a'], denyList: [] });
    });

    it('snapshots targeting into a plain audit-log object', () => {
      expect(
        snapshotTargeting({
          rolloutPercentage: 5,
          allowList: ['a'],
          denyList: [],
        }),
      ).toEqual({ rolloutPercentage: 5, allowList: ['a'], denyList: [] });
      expect(snapshotTargeting(null)).toBeNull();
    });

    it('copies lists into the snapshot so later mutation cannot rewrite history', () => {
      const allowList = ['a'];
      const snapshot = snapshotTargeting({
        rolloutPercentage: 5,
        allowList,
        denyList: [],
      });
      allowList.push('b');
      expect(snapshot?.allowList).toEqual(['a']);
    });
  });
});
