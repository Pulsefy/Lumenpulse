import { config, getEnvironmentConfig } from '../config';
import {
  ESTIMATED_FEE_XLM,
  MAX_CONTRIBUTION_AMOUNT,
  MIN_CONTRIBUTION_AMOUNT,
  buildExplorerUrl,
  computeFundingProgress,
  formatTokenAmount,
  validateContributionAmount,
} from '../stellar';

describe('stellar utils', () => {
  it('accepts valid contribution amounts within the allowed range', () => {
    expect(validateContributionAmount('10')).toBeNull();
    expect(validateContributionAmount('5.5')).toBeNull();
  });

  it('rejects invalid, negative, and too-small values', () => {
    expect(validateContributionAmount('')).toBe('Please enter an amount.');
    expect(validateContributionAmount('-5')).toBe('Amount must be greater than zero.');
    expect(validateContributionAmount('0.001')).toBe(`Minimum contribution is ${MIN_CONTRIBUTION_AMOUNT} XLM.`);
  });

  it('rejects values above the maximum contribution threshold', () => {
    const tooHigh = (Number(MAX_CONTRIBUTION_AMOUNT) + 1).toString();
    expect(validateContributionAmount(tooHigh)).toBe(`Maximum contribution is ${MAX_CONTRIBUTION_AMOUNT} XLM per transaction.`);
  });

  it('builds the explorer URL using the active network', () => {
    expect(buildExplorerUrl('abc123')).toContain('/tx/abc123');
    expect(buildExplorerUrl('abc123')).toContain('stellar');
  });

  it('formats token amounts without exploding decimals', () => {
    expect(formatTokenAmount('1234567')).toBe('1,234,567');
    expect(formatTokenAmount(42.1234567, 7)).toBe('42.1234567');
  });

  it('computes funding progress with a cap at 100%', () => {
    expect(computeFundingProgress('50', '100')).toBe(50);
    expect(computeFundingProgress('200', '100')).toBe(100);
    expect(computeFundingProgress('invalid', '100')).toBe(0);
  });

  it('keeps the public config values available for the app', () => {
    expect(ESTIMATED_FEE_XLM).toBe('0.01');
    expect(getEnvironmentConfig().apiBaseUrl.length).toBeGreaterThan(0);
    expect(config.stellar.network).toBe('testnet');
  });
});
