import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  IDEMPOTENT_OPTIONS_KEY,
  IdempotentOptions,
} from '../decorators/idempotent.decorator';
import { IdempotencyService } from '../../idempotency/idempotency.service';

/**
 * Idempotency for write endpoints.
 *
 * When a request carries an `Idempotency-Key` header, its response is persisted
 * (keyed by method + route + body hash) and replayed verbatim for a repeated
 * key within the retention window. Concurrent requests with the same key are
 * serialised: the first executes, the rest wait and then receive the same
 * response instead of re-executing.
 *
 * Storage is the `idempotency_records` table. Expired keys are purged by the
 * `IdempotencyScheduler` on the documented cleanup schedule.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly service: IdempotencyService,
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
    const headerValue = request.headers[headerName.toLowerCase()];
    if (!headerValue || typeof headerValue !== 'string') {
      return next.handle();
    }

    const route = request.path;
    const method = request.method;
    const requestHash = IdempotencyService.hashRequest(
      method,
      route,
      request.body,
    );

    const outcome = await this.service.acquire(
      headerValue,
      method,
      route,
      requestHash,
      { retentionMs: options.ttl },
    );

    switch (outcome.kind) {
      case 'replay': {
        this.logger.debug(
          `Replaying cached response for idempotency key ${headerValue}`,
        );
        const response = httpContext.getResponse<Response>();
        response.status(outcome.record.responseStatus ?? HttpStatus.OK);
        return of(outcome.record.responseBody);
      }

      case 'hash-mismatch':
        throw new HttpException(
          'Idempotency key was used with a different request body.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );

      case 'in-progress': {
        // Another request owns this key and is executing. Wait for it and
        // return its response, so a concurrent retry neither duplicates the
        // operation nor gets an error for trying.
        const completed = await this.service.waitForCompletion(
          outcome.record.id,
        );
        if (!completed) {
          throw new HttpException(
            'Request with this idempotency key is already in progress.',
            HttpStatus.CONFLICT,
          );
        }
        const response = httpContext.getResponse<Response>();
        response.status(completed.responseStatus ?? HttpStatus.OK);
        return of(completed.responseBody);
      }

      case 'acquired': {
        return next.handle().pipe(
          tap((body: unknown) => {
            const status = this.resolveStatus(request, context);
            void this.service
              .complete(outcome.record, status, body)
              .catch((err: Error) =>
                this.logger.error(
                  `Failed to persist idempotency result: ${err.message}`,
                ),
              );
          }),
          catchError((err: Error) => {
            // The operation failed — drop the claim so the client can retry.
            void this.service
              .release(outcome.record.id)
              .catch((releaseErr: Error) =>
                this.logger.error(
                  `Failed to release idempotency claim: ${releaseErr.message}`,
                ),
              );
            return throwError(() => err);
          }),
        );
      }
    }
  }

  private resolveStatus(request: Request, context: ExecutionContext): number {
    const explicit = this.reflector.get<number>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    if (explicit) return explicit;
    return request.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }
}
