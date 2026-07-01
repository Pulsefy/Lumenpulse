import {
  VestingWalletException,
  VestingWalletInvalidAmountException,
  VestingWalletInvalidDurationException,
  VestingWalletInvalidStartTimeException,
  VestingWalletNotInitializedException,
  VestingWalletNothingToClaimException,
  VestingWalletReentrancyException,
  VestingWalletNotFoundException,
  VestingWalletTransactionFailedException,
  VestingWalletUnauthorizedException,
  VestingWalletInsufficientBalanceException,
} from './exceptions/vesting-wallet.exceptions';

export enum VestingWalletContractError {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  Unauthorized = 3,
  VestingNotFound = 4,
  InvalidAmount = 5,
  InvalidDuration = 6,
  InvalidStartTime = 7,
  NothingToClaim = 8,
  InsufficientBalance = 9,
  Reentrancy = 10,
  DelegateNotAuthorized = 11,
}

export function mapVestingWalletContractErrorCode(
  code: number,
  fallbackMessage?: string,
  beneficiary?: string,
): VestingWalletException {
  switch (code) {
    case 1: // VestingWalletContractError.NotInitialized
      return new VestingWalletNotInitializedException();
    case 3: // VestingWalletContractError.Unauthorized
      return new VestingWalletUnauthorizedException();
    case 5: // VestingWalletContractError.InvalidAmount
      return new VestingWalletInvalidAmountException();
    case 6: // VestingWalletContractError.InvalidDuration
      return new VestingWalletInvalidDurationException();
    case 7: // VestingWalletContractError.InvalidStartTime
      return new VestingWalletInvalidStartTimeException();
    case 4: // VestingWalletContractError.VestingNotFound
      return new VestingWalletNotFoundException(beneficiary ?? 'unknown');
    case 8: // VestingWalletContractError.NothingToClaim
      return new VestingWalletNothingToClaimException();
    case 10: // VestingWalletContractError.Reentrancy
      return new VestingWalletReentrancyException();
    case 9: // VestingWalletContractError.InsufficientBalance
      return new VestingWalletInsufficientBalanceException();
    case 11: // VestingWalletContractError.DelegateNotAuthorized
      return new VestingWalletUnauthorizedException();
    default:
      return new VestingWalletTransactionFailedException(fallbackMessage, {
        contractErrorCode: code,
      });
  }
}

export function extractVestingWalletContractErrorCode(
  message: string,
): number | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

export function toVestingWalletException(
  message: string,
  beneficiary?: string,
): VestingWalletException {
  const code = extractVestingWalletContractErrorCode(message);
  if (code !== null) {
    return mapVestingWalletContractErrorCode(code, message, beneficiary);
  }
  return new VestingWalletTransactionFailedException(message);
}
