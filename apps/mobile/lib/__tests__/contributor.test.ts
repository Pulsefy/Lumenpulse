import {
  getTierColor,
  getVerificationStatusColor,
  getVerificationStatusLabel,
  contributorApi,
} from '../contributor';

export function testTierColors(): boolean {
  const tests = [
    { tier: 'Core', expected: '#8b5cf6' },
    { tier: 'Architect', expected: '#3b82f6' },
    { tier: 'Builder', expected: '#10b981' },
    { tier: 'Novice', expected: '#f59e0b' },
    { tier: undefined, expected: '#f59e0b' },
  ];

  const results = tests.map(({ tier, expected }) => {
    const res = getTierColor(tier);
    const pass = res === expected;
    console.log(`${pass ? '✓' : '✗'} Tier color for '${tier}' => ${res}`);
    return pass;
  });

  return results.every(Boolean);
}

export function testVerificationStatusHelpers(): boolean {
  const tests = [
    { status: 'VERIFIED', color: '#10b981', label: 'Verified Contributor' },
    { status: 'PENDING', color: '#f59e0b', label: 'Pending Review' },
    { status: 'REJECTED', color: '#ef4444', label: 'Verification Rejected' },
    { status: 'ARCHIVED', color: '#64748b', label: 'Archived Identity' },
    { status: 'UNREGISTERED', color: '#94a3b8', label: 'Unregistered Identity' },
  ];

  const results = tests.map(({ status, color, label }) => {
    const resColor = getVerificationStatusColor(status);
    const resLabel = getVerificationStatusLabel(status);
    const pass = resColor === color && resLabel === label;
    console.log(
      `${pass ? '✓' : '✗'} Status '${status}' => Color: ${resColor}, Label: "${resLabel}"`
    );
    return pass;
  });

  return results.every(Boolean);
}

export function testContributorApiMethods(): boolean {
  const methods = ['getByAddress', 'getByGithub', 'getReputation', 'getVerificationState'];
  const results = methods.map((m) => {
    const exists = typeof (contributorApi as any)[m] === 'function';
    console.log(`${exists ? '✓' : '✗'} contributorApi.${m} exists`);
    return exists;
  });

  return results.every(Boolean);
}

export async function runContributorTests(): Promise<boolean> {
  console.log('=== Contributor Module Tests ===\n');

  console.log('1. Testing tier colors...');
  const t1 = testTierColors();
  console.log(t1 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('2. Testing verification status helpers...');
  const t2 = testVerificationStatusHelpers();
  console.log(t2 ? '✓ PASS\n' : '✗ FAIL\n');

  console.log('3. Testing contributor API method signatures...');
  const t3 = testContributorApiMethods();
  console.log(t3 ? '✓ PASS\n' : '✗ FAIL\n');

  const allPassed = t1 && t2 && t3;
  console.log(allPassed ? '=== ALL CONTRIBUTOR TESTS PASSED ===' : '=== TESTS FAILED ===');
  return allPassed;
}
