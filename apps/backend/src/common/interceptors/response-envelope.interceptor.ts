import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import {
  SKIP_RESPONSE_ENVELOPE_KEY,
  SkipResponseEnvelope,
} from '../decorators/skip-response-envelope.decorator';

/**
 * Standardized API response envelope interceptor.
 *
 * Wraps all successful responses in a consistent envelope structure:
 * - Success: { success: true, data: T }
 * - Errors: Handled by exception filters (not this interceptor)
 *
 * Endpoints can opt-out using @SkipResponseEnvelope() decorator.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseEnvelopeInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check if endpoint should skip envelope wrapping
    const skipEnvelope = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_ENVELOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipEnvelope) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<Response>();

        // Handle 204 No Content responses
        if (response.statusCode === 204) {
          return {
            success: true,
            data: null,
          };
        }

        // Return wrapped response
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
