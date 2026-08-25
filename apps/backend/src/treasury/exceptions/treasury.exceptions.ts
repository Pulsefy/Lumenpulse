import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';

/**
 * Base class for treasury errors.
 *
 * The {@link GlobalExceptionFilter} reads the `code` property from the response
 * body to populate the standard API error contract, so every treasury exception
 * carries an {@link ErrorCode}.
 */
export class TreasuryException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

/** The treasury contract address is not configured on the server. */
export class TreasuryNotConfiguredException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_NOT_CONFIGURED,
      'Treasury contract is not configured. Set STELLAR_CONTRACT_TREASURY.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** The on-chain treasury contract has not been initialized. */
export class TreasuryNotInitializedException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_NOT_INITIALIZED,
      'Treasury contract has not been initialized.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The caller is not the treasury admin. */
export class TreasuryUnauthorizedException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_UNAUTHORIZED,
      'Caller is not authorized to perform this treasury operation.',
      HttpStatus.FORBIDDEN,
    );
  }
}

/** The requested allocation amount is invalid (must be > 0). */
export class TreasuryInvalidAmountException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_INVALID_AMOUNT,
      'Allocation amount must be a positive integer.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** The requested stream duration is invalid (must be > 0). */
export class TreasuryInvalidDurationException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_INVALID_DURATION,
      'Stream duration must be greater than zero.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** The requested start time is invalid. */
export class TreasuryInvalidStartTimeException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_INVALID_START_TIME,
      'Stream start time is invalid.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** No stream exists for the requested beneficiary. */
export class TreasuryStreamNotFoundException extends TreasuryException {
  constructor(beneficiary: string) {
    super(
      ErrorCode.TREAS_STREAM_NOT_FOUND,
      `No treasury stream found for beneficiary ${beneficiary}.`,
      HttpStatus.NOT_FOUND,
      { beneficiary },
    );
  }
}

/** There is nothing currently unlocked to claim. */
export class TreasuryNothingToClaimException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_NOTHING_TO_CLAIM,
      'No unlocked funds are available to claim.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The treasury contract rejected a re-entrant call. */
export class TreasuryReentrancyException extends TreasuryException {
  constructor() {
    super(
      ErrorCode.TREAS_REENTRANCY,
      'Treasury contract rejected a re-entrant call.',
      HttpStatus.CONFLICT,
    );
  }
}

/** The Soroban RPC endpoint is unavailable or unreachable. */
export class TreasuryRpcUnavailableException extends TreasuryException {
  constructor(cause?: string, details?: Record<string, unknown>) {
    super(
      ErrorCode.TREAS_RPC_UNAVAILABLE,
      `Soroban RPC is unavailable${cause ? `: ${cause}` : ''}.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}

/** A submitted treasury transaction failed on-chain or during simulation. */
export class TreasuryTransactionFailedException extends TreasuryException {
  constructor(cause?: string, details?: Record<string, unknown>) {
    super(
      ErrorCode.TREAS_TRANSACTION_FAILED,
      `Treasury transaction failed${cause ? `: ${cause}` : ''}.`,
      HttpStatus.BAD_GATEWAY,
      details,
    );
  }
}
