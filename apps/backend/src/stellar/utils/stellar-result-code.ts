import { xdr } from '@stellar/stellar-sdk';

/**
 * Stellar result codes are exposed by the SDK as camel-cased union members
 * (e.g. `txBadSeq`). Operational tooling, Horizon and `stellar-core` all refer
 * to them in snake_case (`tx_bad_seq`), so we normalise before using a code as
 * a log field or a metric label.
 */
export function toSnakeCaseResultCode(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Numeric `TransactionResultCode` values from `stellar-core`.
 * Used as a fallback when the SDK union member cannot be read directly.
 * @see https://github.com/stellar/stellar-core/blob/master/src/xdr/Stellar-transaction.x
 */
const NUMERIC_TRANSACTION_RESULT_CODES: Record<number, string> = {
  1: 'tx_fee_bump_inner_success',
  0: 'tx_success',
  '-1': 'tx_failed',
  '-2': 'tx_too_early',
  '-3': 'tx_too_late',
  '-4': 'tx_missing_operation',
  '-5': 'tx_bad_seq',
  '-6': 'tx_bad_auth',
  '-7': 'tx_insufficient_balance',
  '-8': 'tx_no_account',
  '-9': 'tx_insufficient_fee',
  '-10': 'tx_bad_auth_extra',
  '-11': 'tx_internal_error',
  '-12': 'tx_not_supported',
  '-13': 'tx_fee_bump_inner_failed',
  '-14': 'tx_bad_sponsorship',
  '-15': 'tx_bad_min_seq_age_or_gap',
  '-16': 'tx_malformed',
  '-17': 'tx_soroban_invalid',
};

/** The result code returned when a transaction reuses a stale sequence number. */
export const BAD_SEQUENCE_RESULT_CODE = 'tx_bad_seq';

/** `SorobanErrorCode.SUBMISSION_BAD_SEQUENCE` (inlined to avoid a cyclic import). */
const SUBMISSION_BAD_SEQUENCE_CODE = 'SOROBAN_SUBMISSION_BAD_SEQUENCE';

/**
 * Extracts a snake_case `TransactionResultCode` from the payload returned by
 * `SorobanRpcServer.sendTransaction` (`errorResult`), which may be an
 * `xdr.TransactionResult`, a base64/hex encoded XDR string, or a plain code
 * string. Returns `null` when no code can be determined.
 */
export function extractTransactionResultCode(errorResult: unknown): string | null {
  if (errorResult === null || errorResult === undefined) {
    return null;
  }

  if (typeof errorResult === 'string') {
    const trimmed = errorResult.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      return extractTransactionResultCode(
        xdr.TransactionResult.fromXDR(trimmed, 'base64'),
      );
    } catch {
      return toSnakeCaseResultCode(trimmed);
    }
  }

  if (typeof errorResult !== 'object') {
    return null;
  }

  const record = errorResult as {
    name?: unknown;
    value?: unknown;
    result?: unknown;
    switch?: unknown;
  };

  // `xdr.TransactionResult` exposes the result code via `result()`.
  if (typeof record.result === 'function') {
    try {
      return extractTransactionResultCode(
        (record.result as () => unknown).call(errorResult),
      );
    } catch {
      /* fall through to the other accessors */
    }
  }

  // The code itself is a union: `switch()` returns the active member.
  if (typeof record.switch === 'function') {
    try {
      return extractTransactionResultCode(
        (record.switch as () => unknown).call(errorResult),
      );
    } catch {
      /* fall through to the other accessors */
    }
  }

  if (typeof record.name === 'string' && record.name.length > 0) {
    return toSnakeCaseResultCode(record.name);
  }

  const numeric = Number(record.value);
  if (Number.isFinite(numeric) && `${numeric}` in NUMERIC_TRANSACTION_RESULT_CODES) {
    return NUMERIC_TRANSACTION_RESULT_CODES[numeric];
  }

  return null;
}

/**
 * True when the error represents a `tx_bad_seq` rejection. Checked
 * structurally (rather than via `instanceof`) so callers in other modules can
 * use it without importing the Soroban RPC service.
 */
export function isBadSequenceError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  if (typeof error === 'string') {
    return /tx_bad_seq|txBadSeq/.test(error);
  }

  if (typeof error !== 'object') {
    return false;
  }

  const record = error as {
    code?: unknown;
    resultCode?: unknown;
    message?: unknown;
  };

  if (record.resultCode === BAD_SEQUENCE_RESULT_CODE) {
    return true;
  }

  if (record.code === SUBMISSION_BAD_SEQUENCE_CODE) {
    return true;
  }

  return (
    typeof record.message === 'string' &&
    /tx_bad_seq|txBadSeq/.test(record.message)
  );
}
