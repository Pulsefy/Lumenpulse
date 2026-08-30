import { Test, TestingModule } from '@nestjs/testing';
import { ContractErrorService } from './contract-error.service';
import {
  CONTRACT_ERROR_REGISTRY,
  CONTRACT_RANGES,
  ContractErrorEntry,
} from './contract-error-registry';

describe('ContractErrorService', () => {
  let service: ContractErrorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContractErrorService],
    }).compile();
    service = module.get<ContractErrorService>(ContractErrorService);
  });

  // ── Registry integrity: overlap / allocation guard ────────────────────────
  // These tests act as a lint gate: they FAIL when two contracts declare the
  // same numeric code or when any code falls outside its contract's range.
  // Run via: cd apps/backend && pnpm test -- --testPathPattern=contract-error

  describe('Registry integrity (overlap guard)', () => {
    it('should have no duplicate numeric codes across contracts', () => {
      const codes = Object.keys(CONTRACT_ERROR_REGISTRY).map(Number);
      const seen = new Set<number>();
      const duplicates: number[] = [];

      for (const code of codes) {
        if (seen.has(code)) {
          duplicates.push(code);
        }
        seen.add(code);
      }

      if (duplicates.length > 0) {
        throw new Error(
          `Duplicate contract error codes detected: ${duplicates.join(', ')}. ` +
            'Each contract must occupy a unique numeric range.',
        );
      }
      expect(duplicates).toEqual([]);
    });

    it('should have all codes within their declared contract range', () => {
      const violations: string[] = [];

      for (const [codeStr, entry] of Object.entries(CONTRACT_ERROR_REGISTRY)) {
        const code = Number(codeStr);
        const range = CONTRACT_RANGES[entry.contract];

        if (!range) {
          violations.push(
            `Code ${code}: contract '${entry.contract}' has no declared range in CONTRACT_RANGES`,
          );
          continue;
        }

        const [min, max] = range;
        if (code < min || code > max) {
          violations.push(
            `Code ${code} (${entry.contract}::${entry.variant}) is outside declared range [${min}, ${max}]`,
          );
        }
      }

      if (violations.length > 0) {
        throw new Error(
          'Contract error codes outside their declared ranges:\n' +
            violations.join('\n'),
        );
      }
      expect(violations).toEqual([]);
    });

    it('should have no overlapping ranges between contracts', () => {
      const ranges = Object.entries(CONTRACT_RANGES) as [
        string,
        [number, number],
      ][];
      const overlaps: string[] = [];

      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const [nameA, [minA, maxA]] = ranges[i];
          const [nameB, [minB, maxB]] = ranges[j];
          // Two ranges [a,b] and [c,d] overlap iff a <= d && c <= b
          if (minA <= maxB && minB <= maxA) {
            overlaps.push(
              `Range overlap: ${nameA} [${minA},${maxA}] overlaps ${nameB} [${minB},${maxB}]`,
            );
          }
        }
      }

      if (overlaps.length > 0) {
        throw new Error(
          'Overlapping contract error ranges detected:\n' + overlaps.join('\n'),
        );
      }
      expect(overlaps).toEqual([]);
    });

    it('should have all registry codes within some known contract range', () => {
      const rangeList = Object.values(CONTRACT_RANGES) as [number, number][];
      const outOfRange: number[] = [];

      for (const codeStr of Object.keys(CONTRACT_ERROR_REGISTRY)) {
        const code = Number(codeStr);
        const inRange = rangeList.some(([min, max]) => code >= min && code <= max);
        if (!inRange) outOfRange.push(code);
      }

      if (outOfRange.length > 0) {
        throw new Error(
          `Error codes not within any declared range: ${outOfRange.join(', ')}`,
        );
      }
      expect(outOfRange).toEqual([]);
    });

    it('should have exactly 14 contracts represented in the registry', () => {
      const contracts = new Set(
        Object.values(CONTRACT_ERROR_REGISTRY).map(
          (e: ContractErrorEntry) => e.contract,
        ),
      );
      expect(contracts.size).toBe(14);
    });

    it('should have exactly 14 contracts declared in CONTRACT_RANGES', () => {
      expect(Object.keys(CONTRACT_RANGES).length).toBe(14);
    });

    it('should have the same contract names in registry and ranges', () => {
      const registryContracts = new Set(
        Object.values(CONTRACT_ERROR_REGISTRY).map(
          (e: ContractErrorEntry) => e.contract,
        ),
      );
      const rangeContracts = new Set(Object.keys(CONTRACT_RANGES));

      const missingInRanges = [...registryContracts].filter(
        (c) => !rangeContracts.has(c),
      );
      const missingInRegistry = [...rangeContracts].filter(
        (c) => !registryContracts.has(c),
      );

      expect(missingInRanges).toEqual([]);
      expect(missingInRegistry).toEqual([]);
    });
  });

  // ── ContractErrorService unit tests ───────────────────────────────────────

  describe('resolve()', () => {
    it('should resolve a known code', () => {
      const result = service.resolve(1001);
      expect(result).toEqual({
        code: 1001,
        contract: 'contributor_registry',
        variant: 'NotInitialized',
        message: 'Contract is not initialized',
      });
    });

    it('should return null for an unknown code', () => {
      expect(service.resolve(9999)).toBeNull();
    });

    it('should return null for code 0', () => {
      expect(service.resolve(0)).toBeNull();
    });

    it('should resolve the first code of each contract range', () => {
      const firstCodes: Record<string, number> = {
        contributor_registry:  1001,
        'vesting-wallet':      1101,
        project_registry:      1201,
        treasury:              1301,
        crowdfund_vault:       1401,
        'lumenpulse-curation': 1501,
        feature_flags:         1601,
        notification_broker:   1701,
        'upgradable-contract': 1801,
        'cross-contract-view': 1901,
        pricing_adapter:       2001,
        matching_pool:         2101,
        protocol_registry:     2201,
        yield_vault:           2301,
      };

      for (const [contract, code] of Object.entries(firstCodes)) {
        const result = service.resolve(code);
        expect(result).not.toBeNull();
        expect(result?.contract).toBe(contract);
      }
    });

    it('should resolve the last known code in crowdfund_vault range', () => {
      const result = service.resolve(1440);
      expect(result).not.toBeNull();
      expect(result?.contract).toBe('crowdfund_vault');
      expect(result?.variant).toBe('InvalidBatch');
    });
  });

  describe('resolveMessage()', () => {
    it('should return the message for a known code', () => {
      expect(service.resolveMessage(1201)).toBe('Contract is not initialized');
    });

    it('should return the message for another known code', () => {
      expect(service.resolveMessage(2104)).toBe('Round not found');
    });

    it('should return a fallback message for an unknown code', () => {
      expect(service.resolveMessage(0)).toBe('Unknown contract error (code: 0)');
    });

    it('should return a fallback message for code 42', () => {
      expect(service.resolveMessage(42)).toBe(
        'Unknown contract error (code: 42)',
      );
    });
  });

  describe('isKnown()', () => {
    it('should return true for a registered code', () => {
      expect(service.isKnown(1401)).toBe(true);
    });

    it('should return true for every code in the registry', () => {
      for (const codeStr of Object.keys(CONTRACT_ERROR_REGISTRY)) {
        expect(service.isKnown(Number(codeStr))).toBe(true);
      }
    });

    it('should return false for an unregistered code', () => {
      expect(service.isKnown(42)).toBe(false);
    });

    it('should return false for code 0', () => {
      expect(service.isKnown(0)).toBe(false);
    });
  });

  describe('byContract()', () => {
    it('should return all 4 errors for feature_flags', () => {
      const results = service.byContract('feature_flags');
      expect(results.length).toBe(4);
      expect(results.every((r) => r.contract === 'feature_flags')).toBe(true);
    });

    it('should return all 22 errors for contributor_registry', () => {
      const results = service.byContract('contributor_registry');
      expect(results.length).toBe(22);
    });

    it('should return all 40 errors for crowdfund_vault', () => {
      const results = service.byContract('crowdfund_vault');
      expect(results.length).toBe(40);
    });

    it('should return all 23 errors for treasury', () => {
      const results = service.byContract('treasury');
      expect(results.length).toBe(23);
    });

    it('should return all 21 errors for matching_pool', () => {
      const results = service.byContract('matching_pool');
      expect(results.length).toBe(21);
    });

    it('should return results with correct code types', () => {
      const results = service.byContract('yield_vault');
      expect(results.length).toBe(10);
      for (const r of results) {
        expect(typeof r.code).toBe('number');
        expect(r.code).toBeGreaterThanOrEqual(2301);
        expect(r.code).toBeLessThanOrEqual(2310);
      }
    });

    it('should return empty array for unknown contract', () => {
      expect(service.byContract('does_not_exist')).toEqual([]);
    });
  });
});
