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

  // URI versioning: /v1/..., /v2/... etc. Defaults to '1' for all controllers.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Same builder as `scripts/generate-openapi.ts`, so the served spec and the
  // committed openapi.json artifact never diverge.
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.port;
  await app.listen(port);

  const network = config.stellar.network.toUpperCase();
  const env = config.environment;
  const isMainnet = config.stellar.network === 'mainnet';
  const facilitiesStatus = isMainnet
    ? 'DISABLED (PROVABLY UNREACHABLE)'
    : 'ACTIVE (TESTNET ONLY)';

  console.log(`
┌──────────────────────────────────────────────────────────────────────────────┐
│                       LUMENPULSE BACKEND API BOOT                            │
├──────────────────────────────────────────────────────────────────────────────┤
│  Active Network:    ${network.padEnd(54)}│
│  Environment:       ${env.padEnd(54)}│
│  Port:              ${String(port).padEnd(54)}│
│  API Version:       v1 (Default URI Versioning)                             │
│  Test/Demo Routes:  ${facilitiesStatus.padEnd(54)}│
│  Swagger Docs:      http://localhost:${String(port)}/api/docs${' '.repeat(Math.max(0, 36 - String(port).length))}│
└──────────────────────────────────────────────────────────────────────────────┘
`);
}

void bootstrap();
