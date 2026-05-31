import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';

export class VestingWalletException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, error: 'Vesting Wallet Error', ...details }, status);
  }
}

export class VestingWalletNotConfiguredException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_NOT_CONFIGURED,
      'Vesting Wallet contract is not configured. Set STELLAR_CONTRACT_VESTING_WALLET.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class VestingWalletNotInitializedException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_NOT_INITIALIZED,
      'Vesting Wallet contract has not been initialized.',
      HttpStatus.CONFLICT,
    );
  }
}

export class VestingWalletUnauthorizedException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_UNAUTHORIZED,
      'Caller is not authorized to perform this vesting operation.',
      HttpStatus.FORBIDDEN,
    );
  }
}

export class VestingWalletInvalidAmountException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_INVALID_AMOUNT,
      'Allocation amount must be a positive integer.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class VestingWalletInvalidDurationException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_INVALID_DURATION,
      'Vesting duration must be greater than zero.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class VestingWalletInvalidStartTimeException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_INVALID_START_TIME,
      'Vesting start time is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class VestingWalletNotFoundException extends VestingWalletException {
  constructor(beneficiary: string) {
    super(
      ErrorCode.VEST_NOT_FOUND,
      `No vesting schedule found for beneficiary ${beneficiary}.`,
      HttpStatus.NOT_FOUND,
      { beneficiary },
    );
  }
}

export class VestingWalletNothingToClaimException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_NOTHING_TO_CLAIM,
      'No unlocked funds are available to claim.',
      HttpStatus.CONFLICT,
    );
  }
}

export class VestingWalletReentrancyException extends VestingWalletException {
  constructor() {
    super(
      ErrorCode.VEST_REENTRANCY,
      'Vesting Wallet contract rejected a re-entrant call.',
      HttpStatus.CONFLICT,
    );
  }
}

export class VestingWalletRpcUnavailableException extends VestingWalletException {
  constructor(cause?: string) {
    super(
      ErrorCode.VEST_RPC_UNAVAILABLE,
      `Soroban RPC is unavailable${cause ? `: ${cause}` : ''}.`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class VestingWalletTransactionFailedException extends VestingWalletException {
  constructor(cause?: string, details?: Record<string, unknown>) {
    super(
      ErrorCode.VEST_TRANSACTION_FAILED,
      `Vesting Wallet transaction failed${cause ? `: ${cause}` : ''}.`,
      HttpStatus.BAD_GATEWAY,
      details,
    );
  }
}
