import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_HEADER_LOWER,
} from '../constants/request.constants';

type RequestWithRequestId = Request & { requestId?: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const request = req as RequestWithRequestId;
    const incomingRequestId = request.header(REQUEST_ID_HEADER_LOWER)?.trim();
    const requestId = incomingRequestId || randomUUID();

    request.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
