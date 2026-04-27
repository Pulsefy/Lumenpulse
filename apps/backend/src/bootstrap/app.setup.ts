import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';
import { SanitizationPipe } from '../common/pipes/sanitization.pipe';
import { resolveCorsOrigin } from '../lib/config';

function getCorsOrigin(): string | string[] {
  return resolveCorsOrigin();
}

export function setupApp(app: INestApplication): void {
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
  });
}
