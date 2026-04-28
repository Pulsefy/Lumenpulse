import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { StructuredLogger } from '../services/structured-logger.service';

@Injectable()
export class StructuredLoggerMiddleware implements NestMiddleware {
  private readonly logger: StructuredLogger;
  private readonly loggerService = new Logger(StructuredLoggerMiddleware.name);

  constructor() {
    this.logger = new StructuredLogger('HTTP', {
      includeRequestDetails: true,
      excludePaths: ['/health', '/metrics'],
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    // Store original end method with proper typing
    const originalEnd: (
      chunk?: unknown,
      encoding?: unknown,
      callback?: unknown,
    ) => void = res.end.bind(res) as (
      chunk?: unknown,
      encoding?: unknown,
      callback?: unknown,
    ) => void;

    // Use arrow function to avoid 'this' binding issues
    res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown): void => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;

      // Build structured log context
      const context = {
        requestId,
        method: req.method,
        url: req.url,
        statusCode,
        duration,
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
      };

      // Log with structured format
      if (statusCode >= 500) {
        this.logger.logError(
          `HTTP ${req.method} ${req.url} - ${statusCode} - ${duration}ms`,
          context,
          { error: 'Server error' },
          req,
          res,
        );
      } else if (statusCode >= 400) {
        this.logger.logWarn(
          `HTTP ${req.method} ${req.url} - ${statusCode} - ${duration}ms`,
          context,
          { warning: 'Client error' },
          req,
          res,
        );
      } else {
        this.logger.logInfo(
          `HTTP ${req.method} ${req.url} - ${statusCode} - ${duration}ms`,
          context,
          undefined,
          req,
          res,
        );
      }

      // Also log to NestJS logger for backward compatibility
      const message = `[Request:${requestId}] ${req.method} ${req.url} - ${statusCode} - ${duration}ms`;
      if (statusCode >= 500) {
        this.loggerService.error(message);
      } else if (statusCode >= 400) {
        this.loggerService.warn(message);
      } else {
        this.loggerService.log(message);
      }

      // Call the original end method with proper context
      originalEnd(chunk, encoding, callback);
    }) as typeof res.end;

    // Log incoming request
    this.logger.logInfo(
      `Incoming request: ${req.method} ${req.url}`,
      {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip || req.socket.remoteAddress,
      },
      undefined,
      req,
      res,
    );

    next();
  }
}