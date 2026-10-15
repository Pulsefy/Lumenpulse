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
  NotInitialized = 2300,
  AlreadyInitialized = 2301,
  Unauthorized = 2302,
  VestingNotFound = 2303,
  InvalidAmount = 2304,
  InvalidDuration = 2305,
  InvalidStartTime = 2306,
  NothingToClaim = 2307,
  InsufficientBalance = 2308,
  Reentrancy = 2309,
  DelegateNotAuthorized = 2310,
}

export function mapVestingWalletContractErrorCode(
  code: number,
  fallbackMessage?: string,
  beneficiary?: string,
): VestingWalletException {
  switch (code) {
    case 2300: // VestingWalletContractError.NotInitialized
      return new VestingWalletNotInitializedException();
    case 2302: // VestingWalletContractError.Unauthorized
      return new VestingWalletUnauthorizedException();
    case 2304: // VestingWalletContractError.InvalidAmount
      return new VestingWalletInvalidAmountException();
    case 2305: // VestingWalletContractError.InvalidDuration
      return new VestingWalletInvalidDurationException();
    case 2306: // VestingWalletContractError.InvalidStartTime
      return new VestingWalletInvalidStartTimeException();
    case 2303: // VestingWalletContractError.VestingNotFound
      return new VestingWalletNotFoundException(beneficiary ?? 'unknown');
    case 2307: // VestingWalletContractError.NothingToClaim
      return new VestingWalletNothingToClaimException();
    case 2309: // VestingWalletContractError.Reentrancy
      return new VestingWalletReentrancyException();
    case 2308: // VestingWalletContractError.InsufficientBalance
      return new VestingWalletInsufficientBalanceException();
    case 2310: // VestingWalletContractError.DelegateNotAuthorized
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
