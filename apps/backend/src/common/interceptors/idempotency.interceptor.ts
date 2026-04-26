import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { CacheService } from '../../cache/cache.service';
import {
  IDEMPOTENT_OPTIONS_KEY,
  IdempotentOptions,
} from '../decorators/idempotent.decorator';

interface IdempotencyResult {
  statusCode: number;
  body: unknown;
  bodyHash: string;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const options =
      this.reflector.getAllAndOverride<IdempotentOptions>(
        IDEMPOTENT_OPTIONS_KEY,
        [context.getHandler(), context.getClass()],
      ) || {};

    const methods = options.methods || ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (!methods.includes(request.method)) {
      return next.handle();
    }

    const headerName = options.header || 'idempotency-key';
    const idempotencyKey = request.headers[headerName.toLowerCase()];

    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return next.handle();
    }

    // Hash the body to ensure the key is only valid for the same payload
    const bodyHash = this.calculateHash(request.body);
    const cacheKey = `idempotency:${request.path}:${idempotencyKey}`;

    const cachedResult = await this.cacheService.get<
      IdempotencyResult | string
    >(cacheKey);

    if (cachedResult) {
      if (cachedResult === 'IN_PROGRESS') {
        throw new HttpException(
          'Request with this idempotency key is already in progress.',
          HttpStatus.CONFLICT,
        );
      }

      const result = cachedResult as IdempotencyResult;

      // Verify that the body hash matches
      if (result.bodyHash !== bodyHash) {
        throw new HttpException(
          'Idempotency key was used with a different request body.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      this.logger.debug(`Returning cached result for key: ${idempotencyKey}`);
      const response = httpContext.getResponse<Response>();
      response.status(result.statusCode);
      return of(result.body);
    }

    // Mark as in progress to prevent concurrent duplicate requests
    await this.cacheService.set(cacheKey, 'IN_PROGRESS', 60000); // 1 minute lock

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const response = httpContext.getResponse<Response>();
          const result: IdempotencyResult = {
            statusCode: response.statusCode,
            body,
            bodyHash,
          };
          const ttl = options.ttl || 24 * 60 * 60 * 1000; // 24 hours default
          this.cacheService
            .set(cacheKey, result, ttl)
            .catch((err: Error) =>
              this.logger.error(
                `Failed to cache idempotency result: ${err.message}`,
              ),
            );
        },
        error: () => {
          // Remove the lock on error so the client can retry
          this.cacheService
            .del(cacheKey)
            .catch((err: Error) =>
              this.logger.error(
                `Failed to release idempotency lock: ${err.message}`,
              ),
            );
        },
      }),
    );
  }

  private calculateHash(body: unknown): string {
    const data = body ? JSON.stringify(body) : '';
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
