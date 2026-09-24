import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
  REQUEST_ID_HEADER,
  REQUEST_ID_HEADER_LOWER,
} from '../constants/request.constants';
import { RequestContextService } from '../services/request-context.service';

type RequestWithCorrelationId = Request & {
  correlationId?: string;
  requestId?: string;
};

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const request = req as RequestWithCorrelationId;
    const incomingCorrelationId =
      request.header(CORRELATION_ID_HEADER_LOWER)?.trim() ||
      request.header(REQUEST_ID_HEADER_LOWER)?.trim();
    const correlationId = incomingCorrelationId || randomUUID();

    request.correlationId = correlationId;
    request.requestId = correlationId;

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, correlationId);

    // Store in AsyncLocalStorage for access throughout the request lifecycle
    this.requestContextService.run(
      { correlationId, requestId: correlationId },
      () => {
        next();
      },
    );
  }
}
