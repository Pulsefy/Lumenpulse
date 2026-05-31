import './lib/config';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { setupApp } from './bootstrap/app.setup';
import { config } from './lib/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupApp(app);

  // URI versioning: /v1/config/stellar, /v2/... etc.
  app.enableVersioning({ type: VersioningType.URI });

  const swaggerConfig = new DocumentBuilder()
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
    .addTag('config', 'Client-safe testnet/mainnet runtime configuration')
    .addTag('transactions', 'Transaction history and Stellar ledger queries')
    .addTag(
      'soroban-events',
      'Soroban smart contract event ingestion and tracking',
    )
    .addTag('users', 'User profile and account management')
    .addTag('news', 'Crypto news aggregation and sentiment analysis')
    .addTag('portfolio', 'Portfolio tracking and performance metrics')
    .addTag('stellar', 'Stellar blockchain integration')
    .addTag('search', 'Search and discovery endpoints')
    .addServer('http://localhost:3000', 'Development')
    .addServer('https://api.lumenpulse.io', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.port;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs available at: http://localhost:${port}/api/docs`);
}

void bootstrap();
