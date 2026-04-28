import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { StructuredLogger } from '../services/structured-logger.service';

@Injectable()
export class StructuredLoggingInterceptor implements NestInterceptor {
  private readonly logger: StructuredLogger;
  private readonly loggerService = new Logger(StructuredLoggingInterceptor.name);

  constructor(context: string = 'Request') {
    this.logger = new StructuredLogger(context, {
      includeRequestDetails: true,
    });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const requestId = (request as any).requestId || 'unknown';
    const startTime = Date.now();

    // Log request start
    this.logger.logInfo(
      `Request started: ${request.method} ${request.url}`,
      {
        requestId,
        method: request.method,
        url: request.url,
        query: request.query,
        params: request.params,
        ip: request.ip || request.socket.remoteAddress,
        userAgent: request.get('user-agent'),
      },
      undefined,
      request,
      response,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.logInfo(
            `Request completed: ${request.method} ${request.url}`,
            {
              requestId,
              method: request.method,
              url: request.url,
              statusCode,
              duration,
            },
            undefined,
            request,
            response,
          );
        },
        error: (error: Error) => {
          const duration = Date.now() - startTime;

          this.logger.logError(
            `Request failed: ${request.method} ${request.url}`,
            {
              requestId,
              method: request.method,
              url: request.url,
              duration,
              error: error.message,
              stack: error.stack,
            },
            undefined,
            request,
            response,
          );
        },
      }),
    );
  }
}