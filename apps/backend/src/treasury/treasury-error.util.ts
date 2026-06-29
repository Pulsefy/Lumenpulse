/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
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
  NotInitialized = 1,
  AlreadyInitialized = 2,
  Unauthorized = 3,
  InvalidAmount = 4,
  InvalidDuration = 5,
  InvalidStartTime = 6,
  StreamNotFound = 7,
  NothingToClaim = 8,
  Reentrancy = 9,
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
    case TreasuryContractError.NotInitialized:
      return new TreasuryNotInitializedException();
    case TreasuryContractError.Unauthorized:
      return new TreasuryUnauthorizedException();
    case TreasuryContractError.InvalidAmount:
      return new TreasuryInvalidAmountException();
    case TreasuryContractError.InvalidDuration:
      return new TreasuryInvalidDurationException();
    case TreasuryContractError.InvalidStartTime:
      return new TreasuryInvalidStartTimeException();
    case TreasuryContractError.StreamNotFound:
      return new TreasuryStreamNotFoundException(beneficiary ?? 'unknown');
    case TreasuryContractError.NothingToClaim:
      return new TreasuryNothingToClaimException();
    case TreasuryContractError.Reentrancy:
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
