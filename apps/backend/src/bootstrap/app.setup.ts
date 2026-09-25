import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';
import { SanitizationPipe } from '../common/pipes/sanitization.pipe';
import { StructuredLoggerService } from '../common/services/structured-logger.service';
import { resolveCorsOrigin } from '../lib/config';
import { RATE_LIMIT_RESPONSE_HEADERS } from '../common/rate-limit/rate-limit.constants';

function getCorsOrigin(): string | string[] {
  return resolveCorsOrigin();
}

export function setupApp(app: INestApplication): void {
  app.useLogger(new StructuredLoggerService());
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new CustomValidationPipe(), new SanitizationPipe());
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.enableCors({
    origin: getCorsOrigin(),
    // Allow browser clients to read rate-limit headers (incl. Retry-After).
    exposedHeaders: [...RATE_LIMIT_RESPONSE_HEADERS],
  });
}
