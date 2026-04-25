import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CorrelationService } from '../correlation/correlation.service';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const start = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - start;
      const correlationId = this.correlationService.getCorrelationId();

      const logData = {
        method,
        url: originalUrl,
        status: statusCode,
        duration: `${duration}ms`,
        ip,
        userAgent,
        correlationId,
      };

      if (statusCode >= 400) {
        console.warn(JSON.stringify({ level: 'warn', ...logData }));
      } else {
        console.log(JSON.stringify({ level: 'log', ...logData }));
      }
    });

    next();
  }
}
