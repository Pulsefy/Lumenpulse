import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
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
      const message = `[Request] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`;

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
