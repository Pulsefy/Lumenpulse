import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  WebhookProviderConfig,
  WebhookSignatureAlgorithm,
  WebhookVerificationResult,
} from './webhook.types';

/**
 * Framework for verifying signed webhooks from multiple trusted providers.
 * Supports HMAC-SHA256, RSA-SHA256, and Ed25519 signature algorithms.
 */
@Injectable()
export class WebhookVerificationService implements OnModuleInit {
  private readonly logger = new Logger(WebhookVerificationService.name);
  private readonly providers: Map<string, WebhookProviderConfig> = new Map();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.loadProviderConfigs();
  }

  /**
   * Load webhook provider configurations from environment/config
   */
  private loadProviderConfigs(): void {
    // Load from environment variable JSON or individual vars
    const providersJson = this.configService.get<string>('WEBHOOK_PROVIDERS');
    if (providersJson) {
      try {
        const providers = JSON.parse(providersJson) as WebhookProviderConfig[];
        providers.forEach((config) => {
          this.providers.set(config.name, config);
          this.logger.log(`Loaded webhook provider: ${config.name}`);
        });
      } catch (error) {
        this.logger.error('Failed to parse WEBHOOK_PROVIDERS config', error);
      }
    }

    // Legacy fallback: single WEBHOOK_SECRET for backward compatibility
    const legacySecret = this.configService.get<string>('WEBHOOK_SECRET');
    if (legacySecret && !this.providers.has('legacy')) {
      this.providers.set('legacy', {
        name: 'legacy',
        algorithm: WebhookSignatureAlgorithm.HMAC_SHA256,
        secret: legacySecret,
        enabled: true,
      });
    }
  }

  /**
   * Register a webhook provider configuration at runtime
   */
  registerProvider(config: WebhookProviderConfig): void {
    this.providers.set(config.name, config);
    this.logger.log(`Registered webhook provider: ${config.name}`);
  }

  /**
   * Verify webhook signature using the appropriate provider configuration
   */
  verifySignature(
    providerName: string,
    rawBody: Buffer,
    signatureHeader: string,
    timestampHeader?: string,
  ): WebhookVerificationResult {
    const provider = this.providers.get(providerName);

    if (!provider || !provider.enabled) {
      return {
        valid: false,
        error: `Provider '${providerName}' not found or disabled`,
        provider: providerName,
      };
    }

    if (!signatureHeader) {
      return {
        valid: false,
        error: 'Missing signature header',
        provider: providerName,
      };
    }

    try {
      switch (provider.algorithm) {
        case WebhookSignatureAlgorithm.HMAC_SHA256:
          return this.verifyHmacSha256(provider, rawBody, signatureHeader);

        case WebhookSignatureAlgorithm.HMAC_SHA512:
          return this.verifyHmacSha512(provider, rawBody, signatureHeader);

        case WebhookSignatureAlgorithm.RSA_SHA256:
          return this.verifyRsaSha256(
            provider,
            rawBody,
            signatureHeader,
            timestampHeader,
          );

        case WebhookSignatureAlgorithm.ED25519:
          return this.verifyEd25519(
            provider,
            rawBody,
            signatureHeader,
            timestampHeader,
          );

        default:
          return {
            valid: false,
            error: `Unsupported algorithm: ${provider.algorithm as string}`,
            provider: providerName,
          };
      }
    } catch (error) {
      this.logger.error(
        `Signature verification failed for provider ${providerName}`,
        error,
      );
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: providerName,
      };
    }
  }

  /**
   * Verify HMAC-SHA256 signature
   * Format: sha256=<hex>
   */
  private verifyHmacSha256(
    provider: WebhookProviderConfig,
    rawBody: Buffer,
    signatureHeader: string,
  ): WebhookVerificationResult {
    if (!provider.secret) {
      return {
        valid: false,
        error: 'No secret configured for provider',
        provider: provider.name,
      };
    }

    const [scheme, receivedHash] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !receivedHash) {
      return {
        valid: false,
        error: 'Invalid signature format — expected sha256=<hex>',
        provider: provider.name,
      };
    }

    const expectedHash = crypto
      .createHmac('sha256', provider.secret)
      .update(rawBody)
      .digest('hex');

    const isValid = this.safeCompare(expectedHash, receivedHash);

    return {
      valid: isValid,
      error: isValid ? undefined : 'HMAC-SHA256 signature mismatch',
      provider: provider.name,
      algorithm: WebhookSignatureAlgorithm.HMAC_SHA256,
    };
  }

  /**
   * Verify HMAC-SHA512 signature
   * Format: sha512=<hex>
   */
  private verifyHmacSha512(
    provider: WebhookProviderConfig,
    rawBody: Buffer,
    signatureHeader: string,
  ): WebhookVerificationResult {
    if (!provider.secret) {
      return {
        valid: false,
        error: 'No secret configured for provider',
        provider: provider.name,
      };
    }

    const [scheme, receivedHash] = signatureHeader.split('=');
    if (scheme !== 'sha512' || !receivedHash) {
      return {
        valid: false,
        error: 'Invalid signature format — expected sha512=<hex>',
        provider: provider.name,
      };
    }

    const expectedHash = crypto
      .createHmac('sha512', provider.secret)
      .update(rawBody)
      .digest('hex');

    const isValid = this.safeCompare(expectedHash, receivedHash);

    return {
      valid: isValid,
      error: isValid ? undefined : 'HMAC-SHA512 signature mismatch',
      provider: provider.name,
      algorithm: WebhookSignatureAlgorithm.HMAC_SHA512,
    };
  }

  /**
   * Verify RSA-SHA256 signature
   * Format: rsa256=<base64>
   * Optional: timestamp header for replay protection
   */
  private verifyRsaSha256(
    provider: WebhookProviderConfig,
    rawBody: Buffer,
    signatureHeader: string,
    timestampHeader?: string,
  ): WebhookVerificationResult {
    if (!provider.publicKey) {
      return {
        valid: false,
        error: 'No public key configured for provider',
        provider: provider.name,
      };
    }

    // Check timestamp if tolerance is configured
    if (provider.timestampToleranceMs && timestampHeader) {
      const timestampAge = Date.now() - parseInt(timestampHeader, 10);
      if (timestampAge > provider.timestampToleranceMs) {
        return {
          valid: false,
          error: 'Webhook timestamp expired',
          provider: provider.name,
        };
      }
    }

    const [scheme, signatureBase64] = signatureHeader.split('=');
    if (scheme !== 'rsa256' || !signatureBase64) {
      return {
        valid: false,
        error: 'Invalid signature format — expected rsa256=<base64>',
        provider: provider.name,
      };
    }

    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();

    const isValid = verifier.verify(
      provider.publicKey,
      signatureBase64,
      'base64',
    );

    return {
      valid: isValid,
      error: isValid ? undefined : 'RSA-SHA256 signature mismatch',
      provider: provider.name,
      algorithm: WebhookSignatureAlgorithm.RSA_SHA256,
    };
  }

  /**
   * Verify Ed25519 signature
   * Format: ed25519=<base64>
   * Optional: timestamp header for replay protection
   */
  private verifyEd25519(
    provider: WebhookProviderConfig,
    rawBody: Buffer,
    signatureHeader: string,
    timestampHeader?: string,
  ): WebhookVerificationResult {
    if (!provider.publicKey) {
      return {
        valid: false,
        error: 'No public key configured for provider',
        provider: provider.name,
      };
    }

    // Check timestamp if tolerance is configured
    if (provider.timestampToleranceMs && timestampHeader) {
      const timestampAge = Date.now() - parseInt(timestampHeader, 10);
      if (timestampAge > provider.timestampToleranceMs) {
        return {
          valid: false,
          error: 'Webhook timestamp expired',
          provider: provider.name,
        };
      }
    }

    const [scheme, signatureBase64] = signatureHeader.split('=');
    if (scheme !== 'ed25519' || !signatureBase64) {
      return {
        valid: false,
        error: 'Invalid signature format — expected ed25519=<base64>',
        provider: provider.name,
      };
    }

    try {
      const signature = Buffer.from(signatureBase64, 'base64');
      const publicKey = Buffer.from(provider.publicKey, 'base64');

      const verifier = crypto.createVerify('SHA256');
      verifier.update(rawBody);
      verifier.end();

      const isValid = verifier.verify(
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      );

      return {
        valid: isValid,
        error: isValid ? undefined : 'Ed25519 signature mismatch',
        provider: provider.name,
        algorithm: WebhookSignatureAlgorithm.ED25519,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Ed25519 verification error: ${error instanceof Error ? error.message : 'Unknown'}`,
        provider: provider.name,
      };
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Get list of registered providers
   */
  getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get provider configuration (without sensitive data)
   */
  getProviderInfo(providerName: string): Partial<WebhookProviderConfig> | null {
    const provider = this.providers.get(providerName);
    if (!provider) return null;

    // Return safe info without secrets
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { secret, publicKey, ...safeConfig } = provider;
    return safeConfig;
  }
}
