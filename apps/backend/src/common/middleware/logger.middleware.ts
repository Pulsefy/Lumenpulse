import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

type RequestWithRequestId = Request & { requestId?: string };

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const request = req as RequestWithRequestId;
    const startTime = Date.now();

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
    res.end = ((
      chunk?: unknown,
      encoding?: unknown,
      callback?: unknown,
    ): void => {
      const duration = Date.now() - startTime;
      const requestId =
        typeof request.requestId === 'string' ? request.requestId : 'unknown';
      const message = JSON.stringify({
        event: 'http_request_completed',
        requestId,
        method: req.method,
        url: req.originalUrl ?? req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      // Log based on status code
      if (res.statusCode >= 500) {
        Logger.error(message, undefined, 'HTTP');
      } else if (res.statusCode >= 400) {
        Logger.warn(message, 'HTTP');
      } else {
        Logger.log(message, 'HTTP');
      }

      // Call the original end method with proper context
      originalEnd(chunk, encoding, callback);
    }) as typeof res.end;

    next();
  }
}
