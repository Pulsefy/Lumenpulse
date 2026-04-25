import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_HEADER_LOWER,
} from '../constants/request.constants';
import { CorrelationService } from '../correlation/correlation.service';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incomingRequestId = req.header(REQUEST_ID_HEADER_LOWER)?.trim();
    const requestId = incomingRequestId || randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    void this.correlationService.runWithId(requestId, () => {
      next();
    });
  }
}
