import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { WebhookVerificationService } from './webhook-verification.service';

/**
 * Metadata key for webhook provider name
 */
export const WEBHOOK_PROVIDER_KEY = 'webhook:provider';

/**
 * Decorator to specify which webhook provider to use for verification
 */
export const WebhookProvider = (provider: string) => {
  return (
    target: object,
    key?: string | symbol,
    descriptor?: PropertyDescriptor,
  ) => {
    if (descriptor) {
      // Method decorator
      Reflect.defineMetadata(
        WEBHOOK_PROVIDER_KEY,
        provider,
        descriptor.value as object,
      );
    } else {
      // Class decorator
      Reflect.defineMetadata(WEBHOOK_PROVIDER_KEY, provider, target);
    }
  };
};

/**
 * Guard that verifies webhook signatures using the specified provider
 * Apply @WebhookProvider('provider-name') to routes that need verification
 */
@Injectable()
export class WebhookVerificationGuard implements CanActivate {
  private readonly logger = new Logger(WebhookVerificationGuard.name);

  constructor(
    private readonly verificationService: WebhookVerificationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Get provider name from route metadata or query parameter
    let providerName = this.reflector.get<string>(
      WEBHOOK_PROVIDER_KEY,
      context.getHandler(),
    );

    // Fallback to class-level metadata
    if (!providerName) {
      providerName = this.reflector.get<string>(
        WEBHOOK_PROVIDER_KEY,
        context.getClass(),
      );
    }

    // Fallback to query parameter (for dynamic routing)
    if (!providerName) {
      const queryProvider = (request.query as Record<string, unknown>)
        ?.provider as string | undefined;
      providerName =
        queryProvider || (request.headers['x-webhook-provider'] as string);
    }

    if (!providerName) {
      this.logger.warn('No webhook provider specified');
      throw new UnauthorizedException('Webhook provider not specified');
    }

    // Get raw body
    const reqWithRawBody = request as Request & { rawBody?: Buffer };
    const rawBody = reqWithRawBody.rawBody;
    if (!rawBody || !(rawBody instanceof Buffer)) {
      this.logger.warn('Raw body not available for verification');
      throw new UnauthorizedException('Request body not available');
    }

    // Get provider config to determine header names
    const providerInfo = this.verificationService.getProviderInfo(providerName);
    const signatureHeaderName =
      providerInfo?.signatureHeader?.toLowerCase() || 'x-webhook-signature';
    const timestampHeaderName =
      providerInfo?.timestampHeader?.toLowerCase() || 'x-webhook-timestamp';

    const signatureHeader = request.headers[signatureHeaderName] as
      | string
      | undefined;
    const timestampHeader = request.headers[timestampHeaderName] as
      | string
      | undefined;

    if (!signatureHeader) {
      this.logger.warn('Missing signature header');
      throw new UnauthorizedException('Missing signature header');
    }

    // Verify signature
    const result = this.verificationService.verifySignature(
      providerName,
      rawBody,
      signatureHeader,
      timestampHeader,
    );

    // Add verification metadata to request for downstream use
    const reqWithVerification = request as Request & {
      webhookVerification?: object;
    };
    reqWithVerification.webhookVerification = {
      provider: providerName,
      valid: result.valid,
      algorithm: result.algorithm,
      verifiedAt: new Date(),
    };

    if (!result.valid) {
      this.logger.warn(
        `Webhook verification failed for provider ${providerName}: ${result.error}`,
      );
      throw new UnauthorizedException(
        result.error || 'Webhook signature verification failed',
      );
    }

    this.logger.log(
      `Webhook verified successfully from provider ${providerName} using ${result.algorithm}`,
    );

    return await Promise.resolve(true);
  }
}
