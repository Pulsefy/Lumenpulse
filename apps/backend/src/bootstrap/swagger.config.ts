import { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

/**
 * Single source of truth for the OpenAPI document metadata. Shared by
 * src/main.ts (serves /api/docs at runtime) and
 * scripts/generate-openapi-spec.ts (writes the committed artifact used for
 * the CI freshness check and by the webapp's client generation script — see
 * document/openapi-spec.md) so both always describe the exact same API.
 */
export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
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
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-ingest-secret',
        description:
          'Shared secret used by the Soroban indexer/cron to authenticate event ingestion.',
      },
      'soroban-ingest-secret',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-webhook-signature',
        description:
          'HMAC signature of the raw request body, used to authenticate inbound webhook deliveries.',
      },
      'webhook-signature',
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
    .addTag('analytics', 'Aggregated usage and engagement analytics')
    .addTag('app', 'Root application/service info endpoints')
    .addTag('admin-audit-logs', 'Admin-only audit log retrieval')
    .addTag(
      'crowdfund',
      'Soroban crowdfunding project and contribution operations',
    )
    .addTag('exports', 'Asynchronous data export jobs')
    .addTag('feature-flags', 'Runtime feature toggle management')
    .addTag('grants', 'Quadratic-funding grant round management')
    .addTag('health', 'Service and dependency health checks')
    .addTag('metrics', 'Prometheus metrics endpoint (IP-allowlisted)')
    .addTag('admin-models', 'ML model retraining management')
    .addTag('moderation', 'Content moderation queue and actions')
    .addTag(
      'notification-preferences',
      'User notification preference management',
    )
    .addTag('reconciliation', 'Data reconciliation job management')
    .addTag('signals', 'Trading signal subscriptions')
    .addTag(
      'admin-matching-pool',
      'Admin-only Soroban quadratic-funding matching pool operations',
    )
    .addTag('telegram-bot', 'Telegram bot integration')
    .addTag('test', 'Diagnostic/test-only utilities (non-production)')
    .addTag(
      'test-exception',
      'Diagnostic exception-handling utilities (non-production)',
    )
    .addTag('treasury', 'Treasury balance and disbursement operations')
    .addTag('vesting-wallet', 'Soroban vesting wallet management')
    .addTag('watchlist', 'User asset watchlists')
    .addTag('webhooks', 'Inbound webhook event handling')
    .addTag('webhook-admin', 'Admin-only webhook secret management')
    .addServer('http://localhost:3000', 'Development')
    .addServer('https://api.lumenpulse.io', 'Production')
    .build();
}
