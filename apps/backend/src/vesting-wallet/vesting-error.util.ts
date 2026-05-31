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
  switch (code as VestingWalletContractError) {
    case VestingWalletContractError.NotInitialized:
      return new VestingWalletNotInitializedException();
    case VestingWalletContractError.Unauthorized:
      return new VestingWalletUnauthorizedException();
    case VestingWalletContractError.InvalidAmount:
      return new VestingWalletInvalidAmountException();
    case VestingWalletContractError.InvalidDuration:
      return new VestingWalletInvalidDurationException();
    case VestingWalletContractError.InvalidStartTime:
      return new VestingWalletInvalidStartTimeException();
    case VestingWalletContractError.VestingNotFound:
      return new VestingWalletNotFoundException(beneficiary ?? 'unknown');
    case VestingWalletContractError.NothingToClaim:
      return new VestingWalletNothingToClaimException();
    case VestingWalletContractError.Reentrancy:
      return new VestingWalletReentrancyException();
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
