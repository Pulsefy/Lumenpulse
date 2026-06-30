import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Exception thrown when a Stellar account is not found (404)
 */
export class AccountNotFoundException extends HttpException {
  constructor(publicKey: string) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        message: `Account not found: ${publicKey}. The account may not exist or may not have been funded yet.`,
        error: 'Account Not Found',
        publicKey,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * Exception thrown when a Stellar public key is invalid
 */
export class InvalidPublicKeyException extends HttpException {
  constructor(publicKey: string) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Invalid Stellar public key format: ${publicKey}`,
        error: 'Invalid Public Key',
        publicKey,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Exception thrown when Horizon API is unavailable
 */
export class HorizonUnavailableException extends HttpException {
  constructor(horizonUrl: string, cause?: string) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `Stellar Horizon API is unavailable at ${horizonUrl}${cause ? `: ${cause}` : ''}`,
        error: 'Horizon Unavailable',
        horizonUrl,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Exception thrown when Friendbot is unavailable
 */
export class FriendbotUnavailableException extends HttpException {
  constructor(friendbotUrl: string, cause?: string) {
    super(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: `Friendbot is unavailable at ${friendbotUrl}${cause ? `: ${cause}` : ''}`,
        error: 'Friendbot Unavailable',
        friendbotUrl,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/**
 * Exception thrown when Friendbot bootstrap fails
 */
export class FriendbotBootstrapFailedException extends HttpException {
  constructor(publicKey: string, cause?: string) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: `Failed to bootstrap account ${publicKey}${cause ? `: ${cause}` : ''}`,
        error: 'Friendbot Bootstrap Failed',
        publicKey,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
