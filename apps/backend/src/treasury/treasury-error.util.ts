import {
  TreasuryException,
  TreasuryInvalidAmountException,
  TreasuryInvalidDurationException,
  TreasuryInvalidStartTimeException,
  TreasuryNotInitializedException,
  TreasuryNothingToClaimException,
  TreasuryReentrancyException,
  TreasuryStreamNotFoundException,
  TreasuryTransactionFailedException,
  TreasuryUnauthorizedException,
} from './exceptions/treasury.exceptions';

/**
 * Numeric codes emitted by the `TreasuryError` contracterror enum
 * (see `apps/onchain/contracts/treasury/src/errors.rs`). Keep in sync with
 * the contract — these are the `#N` values surfaced by Soroban as
 * `Error(Contract, #N)` in simulation and transaction diagnostics.
 */
export enum TreasuryContractError {
  NotInitialized = 2100,
  AlreadyInitialized = 2101,
  Unauthorized = 2102,
  InvalidAmount = 2103,
  InvalidDuration = 2104,
  InvalidStartTime = 2105,
  StreamNotFound = 2106,
  NothingToClaim = 2107,
  Reentrancy = 2108,
}

/**
 * Maps a known contract error code into the matching API exception.
 * Unknown codes fall back to a generic transaction failure.
 */
export function mapContractErrorCode(
  code: number,
  fallbackMessage?: string,
  beneficiary?: string,
): TreasuryException {
  switch (code) {
    case 2100: // TreasuryContractError.NotInitialized
      return new TreasuryNotInitializedException();
    case 2102: // TreasuryContractError.Unauthorized
      return new TreasuryUnauthorizedException();
    case 2103: // TreasuryContractError.InvalidAmount
      return new TreasuryInvalidAmountException();
    case 2104: // TreasuryContractError.InvalidDuration
      return new TreasuryInvalidDurationException();
    case 2105: // TreasuryContractError.InvalidStartTime
      return new TreasuryInvalidStartTimeException();
    case 2106: // TreasuryContractError.StreamNotFound
      return new TreasuryStreamNotFoundException(beneficiary ?? 'unknown');
    case 2107: // TreasuryContractError.NothingToClaim
      return new TreasuryNothingToClaimException();
    case 2108: // TreasuryContractError.Reentrancy
      return new TreasuryReentrancyException();
    default:
      return new TreasuryTransactionFailedException(fallbackMessage, {
        contractErrorCode: code,
      });
  }
}

/**
 * Extracts a `TreasuryError` contract error code from a Soroban diagnostic
 * string such as `Error(Contract, #7)` or `HostError: Error(Contract, #3)`.
 * Returns `null` when no contract error code is present.
 */
export function extractContractErrorCode(message: string): number | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

/**
 * Translates an arbitrary Soroban error string into the appropriate treasury
 * API exception, mapping known contract error codes and otherwise surfacing a
 * generic transaction failure.
 */
export function toTreasuryException(
  message: string,
  beneficiary?: string,
): TreasuryException {
  const code = extractContractErrorCode(message);
  if (code !== null) {
    return mapContractErrorCode(code, message, beneficiary);
  }
  return new TreasuryTransactionFailedException(message);
}
