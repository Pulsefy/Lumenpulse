import { config } from './config';

/**
 * Possible states for a Stellar/Soroban transaction lifecycle.
 */
export type TransactionStatus =
  | 'idle'
  | 'building'
  | 'signing'
  | 'submitting'
  | 'confirmed'
  | 'failed';

/**
 * Formatted result after a vault contribution attempt.
 */
export interface TransactionResult {
  status: TransactionStatus;
  transactionHash?: string;
  ledger?: number;
  errorMessage?: string;
}

/**
 * Minimum contribution amount in stroops (0.01 XLM = 100_000 stroops).
 * Prevents dust transactions that would waste network fees.
 */
export const MIN_CONTRIBUTION_AMOUNT = '0.01';

/**
 * Maximum contribution amount per single transaction.
 * Acts as a safety rail — large transfers should be batched or reviewed.
 */
export const MAX_CONTRIBUTION_AMOUNT = '1000000';

/**
 * Estimated base fee for a Soroban contract invocation (in XLM).
 * The actual fee is determined at simulation time; this value is shown
 * to the user as an approximate cost before they confirm.
 */
export const ESTIMATED_FEE_XLM = '0.01';

/**
 * Validate a contribution amount string before submission.
 *
 * @returns An error message if invalid, or `null` if valid.
 */
export function validateContributionAmount(amount: string): string | null {
  const trimmed = amount.trim();

  if (!trimmed) {
    return 'Please enter an amount.';
  }

  // Reject anything that isn't a valid positive decimal
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return 'Enter a valid number (e.g. 10 or 5.5).';
  }

  const value = parseFloat(trimmed);

  if (isNaN(value) || value <= 0) {
    return 'Amount must be greater than zero.';
  }

  if (value < parseFloat(MIN_CONTRIBUTION_AMOUNT)) {
    return `Minimum contribution is ${MIN_CONTRIBUTION_AMOUNT} XLM.`;
  }

  if (value > parseFloat(MAX_CONTRIBUTION_AMOUNT)) {
    return `Maximum contribution is ${MAX_CONTRIBUTION_AMOUNT} XLM per transaction.`;
  }

  // Guard against absurd decimal precision (7 decimals is Stellar's max)
  const parts = trimmed.split('.');
  if (parts[1] && parts[1].length > 7) {
    return 'Too many decimal places (max 7).';
  }

  return null;
}

/**
 * Build a Stellar Explorer link for a transaction hash.
 */
export function buildExplorerUrl(transactionHash: string): string {
  const network = config.stellar.network === 'mainnet' ? 'public' : 'testnet';
  return `${config.stellar.explorerUrl}/${network}/tx/${transactionHash}`;
}

/**
 * Format a raw stroops / contract-unit amount into a human-readable XLM string.
 * The crowdfund vault stores amounts as i128 in the smallest unit.
 */
export function formatTokenAmount(raw: string | number, decimals = 7): string {
  const num = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Compute a project's funding progress as a percentage (0–100).
 */
export function computeFundingProgress(deposited: string, target: string): number {
  const dep = parseFloat(deposited);
  const tgt = parseFloat(target);
  if (isNaN(dep) || isNaN(tgt) || tgt <= 0) return 0;
  return Math.min(Math.round((dep / tgt) * 100), 100);
}
