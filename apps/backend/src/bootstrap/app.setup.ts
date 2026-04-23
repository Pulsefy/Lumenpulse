import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';
import { SanitizationPipe } from '../common/pipes/sanitization.pipe';

function getCorsOrigin(): string | string[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = process.env.CORS_ORIGIN?.trim();

  if (origins) {
    return origins.includes(',')
      ? origins.split(',').map((origin) => origin.trim())
      : origins;
  }

  if (isProduction) {
    throw new Error(
      'CORS_ORIGIN must be set in production. Restrict CORS to your frontend URL(s).',
    );
  }

  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
  ];
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
