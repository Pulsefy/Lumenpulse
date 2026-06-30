import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../lib/config';
import { validateStellarPublicKey } from '../utils/stellar-validator';
import {
  FriendbotBootstrapFailedException,
  FriendbotUnavailableException,
  InvalidPublicKeyException,
} from '../exceptions/stellar.exceptions';
import { retryWithBackoff } from '../utils/retry.util';
import { NetworkError } from '@stellar/stellar-sdk';

@Injectable()
export class FriendbotService {
  private readonly logger = new Logger(FriendbotService.name);
  private readonly friendbotUrl: string;

  constructor() {
    this.friendbotUrl = config.friendbot.url;
    this.logger.log(`FriendbotService initialized with Friendbot at ${this.friendbotUrl}`);
  }

  /**
   * Checks if Friendbot is enabled in the configuration
   */
  isEnabled(): boolean {
    return config.friendbot.enabled;
  }

  /**
   * Fund a testnet account using Friendbot
   * @param publicKey The testnet account public key to fund
   * @returns Promise<void>
   */
  async fundAccount(publicKey: string): Promise<void> {
    if (!this.isEnabled()) {
      throw new FriendbotBootstrapFailedException(publicKey, 'Friendbot bootstrap is not enabled');
    }

    // Validate public key format
    validateStellarPublicKey(publicKey);

    this.logger.log(`Attempting to fund account ${publicKey} via Friendbot`);

    try {
      await retryWithBackoff(
        async () => {
          const response = await fetch(`${this.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`, {
            method: 'GET',
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'No error message');
            throw new Error(`Friendbot returned status ${response.status}: ${errorText}`);
          }

          return response.json();
        },
        3,
        1000,
        (error) => {
          // Retry on network errors and 5xx server errors
          if (error instanceof NetworkError) {
            return true;
          }
          const errorObj = error as { response?: { status?: number } };
          const status = errorObj?.response?.status;
          return status === undefined || status >= 500;
        },
      );

      this.logger.log(`Successfully funded account ${publicKey}`);
    } catch (error: unknown) {
      return this.handleError(error, publicKey);
    }
  }

  private handleError(error: unknown, publicKey: string): never {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (error instanceof NetworkError) {
      this.logger.error(`Network error funding account ${publicKey}:`, errorMessage);
      throw new FriendbotUnavailableException(this.friendbotUrl, errorMessage);
    }

    const errorObj = error as { response?: { status?: number } };
    const status = errorObj?.response?.status;

    if (status && status >= 500) {
      this.logger.error(`Friendbot server error (${status}) for account ${publicKey}:`, errorMessage);
      throw new FriendbotUnavailableException(this.friendbotUrl, errorMessage);
    }

    this.logger.error(`Failed to fund account ${publicKey}:`, errorMessage);
    throw new FriendbotBootstrapFailedException(publicKey, errorMessage);
  }
}
