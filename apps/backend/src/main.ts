import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import helmet from 'helmet';

function getCorsOrigin(): string | string[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = process.env.CORS_ORIGIN?.trim();

  if (origins) {
    return origins.includes(',')
      ? origins.split(',').map((o) => o.trim())
      : origins;
  }

  if (isProduction) {
    throw new Error(
      'CORS_ORIGIN must be set in production. Restrict CORS to your frontend URL(s).',
    );
  }

  return ['http://localhost:3000', 'http://localhost:3001'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Register the global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Register global validation pipe with security defaults
  // Runs before sanitization to validate structure first
  app.useGlobalPipes(
    new CustomValidationPipe(),
    // Sanitization pipe should run after validation
    new SanitizationPipe(),
  );

  // Swagger Configuration

  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin: getCorsOrigin(),
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('LumenPulse API')
    .setDescription(
      'Comprehensive API documentation for LumenPulse - A decentralized crypto news aggregator and portfolio management platform built on Stellar blockchain',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'JWT-auth',
    )
    .addTag('auth', 'Authentication and authorization endpoints')
    .addTag('users', 'User profile and account management')
    .addTag('news', 'Crypto news aggregation and sentiment analysis')
    .addTag('portfolio', 'Portfolio tracking and performance metrics')
    .addTag('stellar', 'Stellar blockchain integration')
    .addServer('http://localhost:3000', 'Development')
    .addServer('https://api.lumenpulse.io', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;

  // await app.listen(port);
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
