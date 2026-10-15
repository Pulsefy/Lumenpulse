import './lib/config';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule } from '@nestjs/swagger';
import { setupApp } from './bootstrap/app.setup';
import { config } from './lib/config';
import { createOpenApiDocument } from './openapi/openapi.document';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  // URI versioning: /v1/config/stellar, /v2/... etc.
  app.enableVersioning({ type: VersioningType.URI });

  // Same builder as `scripts/generate-openapi.ts`, so the served spec and the
  // committed openapi.json artifact never diverge.
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.port;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
