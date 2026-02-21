import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
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
      'API documentation for LumenPulse - Interactive API docs for frontend developers',
    )
    .setVersion('1.0')
    .addTag('lumenpulse')
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
