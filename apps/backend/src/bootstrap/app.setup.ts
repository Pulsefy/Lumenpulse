import { INestApplication } from '@nestjs/common';
import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';
import { SanitizationPipe } from '../common/pipes/sanitization.pipe';
import { StructuredLoggerService } from '../common/services/structured-logger.service';
import { resolveCorsOrigin } from '../lib/config';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_HEADER_LOWER,
  MAX_REQUEST_BODY_SIZE_BYTES,
  MAX_REQUEST_NESTING_DEPTH,
  REQUEST_ID_HEADER,
  REQUEST_ID_HEADER_LOWER,
} from '../common/constants/request.constants';
import { ErrorCode } from '../common/enums/error-code.enum';
import { RATE_LIMIT_RESPONSE_HEADERS } from '../common/rate-limit/rate-limit.constants';

type RequestWithRawBody = Request & { rawBody?: Buffer };

function captureRawBody(
  request: Request,
  _response: Response,
  buffer: Buffer,
): void {
  (request as RequestWithRawBody).rawBody = Buffer.from(buffer);
}

function getCorsOrigin(): string | string[] {
  return resolveCorsOrigin();
}

export function setupApp(app: INestApplication): void {
  app.use(
    express.json({
      limit: MAX_REQUEST_BODY_SIZE_BYTES,
      verify: captureRawBody,
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: MAX_REQUEST_BODY_SIZE_BYTES,
      parameterLimit: 1000,
      depth: MAX_REQUEST_NESTING_DEPTH,
      verify: captureRawBody,
    }),
  );
  app.use(
    (
      error: { status?: number; type?: string },
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error?.status !== 413 && error?.type !== 'entity.too.large') {
        next(error);
        return;
      }

      const requestId =
        request.get(REQUEST_ID_HEADER_LOWER) ??
        request.get(CORRELATION_ID_HEADER_LOWER) ??
        randomUUID();
      response.setHeader(REQUEST_ID_HEADER, requestId);
      response.setHeader(CORRELATION_ID_HEADER, requestId);
      response.status(413).json({
        code: ErrorCode.SYS_PAYLOAD_TOO_LARGE,
        message: `Request body exceeds the ${MAX_REQUEST_BODY_SIZE_BYTES}-byte limit`,
        requestId,
        correlationId: requestId,
      });
    },
  );
  app.useLogger(new StructuredLoggerService());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new CustomValidationPipe(), new SanitizationPipe());
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
        },
      },
    }),
  );
  app.enableCors({
    origin: getCorsOrigin(),
    // Allow browser clients to read rate-limit headers (incl. Retry-After).
    exposedHeaders: [...RATE_LIMIT_RESPONSE_HEADERS],
    // Permit credentialed requests only for single-origin dev environments.
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-API-Key',
      'X-Request-Id',
    ],
    maxAge: 86400,
  });
}
