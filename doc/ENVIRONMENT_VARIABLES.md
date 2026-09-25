# Lumenpulse Environment Variables

## Purpose

This document provides a single reference for environment variables used by the Lumenpulse applications and tooling.

It covers:

* Backend
* Webapp
* Mobile
* Data processing
* Onchain/deployment tooling

The matrix distinguishes between local development, CI/test usage, and testnet deployment requirements.

> **Security:** Never commit real credentials, private keys, API keys, tokens, or other secrets to the repository. Use local `.env` files, CI secret stores, or the deployment platform's secret-management facility.

---

## Environment Classification

| Classification  | Meaning                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| **Required**    | The application or tool requires the variable for the relevant operation.                                     |
| **Optional**    | The application has a default value or only requires the variable for a specific feature.                     |
| **Conditional** | Required only when the associated feature, integration, or deployment path is enabled.                        |
| **Secret**      | Contains credentials or sensitive authentication material and must not contain a real value in documentation. |

### Environment scopes

| Scope              | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| **Local**          | Developer workstation configuration.                              |
| **CI/Test**        | Automated tests, validation, and CI workflows.                    |
| **Testnet Deploy** | Configuration required by the Stellar/Soroban deployment tooling. |

---

# 1. Backend

**Configuration source:** `apps/backend/.env.example`, `apps/backend/.env.metrics.example`, and `apps/backend/.env.webhook-notification.example`.

## Core configuration

| Variable      | Requirement | Local | CI/Test | Testnet Deploy |  Secret | Description                                      |
| ------------- | ----------- | ----: | ------: | -------------: | ------: | ------------------------------------------------ |
| `PORT`        | Required    |     ✓ |       ✓ |              — |      No | Backend HTTP port.                               |
| `DB_HOST`     | Required    |     ✓ |       ✓ |              — |      No | PostgreSQL hostname.                             |
| `DB_PORT`     | Required    |     ✓ |       ✓ |              — |      No | PostgreSQL port.                                 |
| `DB_USERNAME` | Required    |     ✓ |       ✓ |              — |      No | PostgreSQL username.                             |
| `DB_DATABASE` | Required    |     ✓ |       ✓ |              — |      No | PostgreSQL database name.                        |
| `DB_NAME`     | Optional    |     ✓ |       ✓ |              — |      No | Legacy database-name alias used by some tooling. |
| `DB_PASSWORD` | Required    |     ✓ |       ✓ |              — | **Yes** | PostgreSQL password.                             |
| `NODE_ENV`    | Optional    |     ✓ |       ✓ |              — |      No | Node.js runtime environment.                     |
| `ENVIRONMENT` | Optional    |     ✓ |       ✓ |              — |      No | Lumenpulse environment identifier.               |
| `CORS_ORIGIN` | Optional    |     ✓ |       ✓ |              — |      No | Comma-separated allowed CORS origins.            |

## Authentication

| Variable         | Requirement | Local | CI/Test | Testnet Deploy |  Secret | Description                  |
| ---------------- | ----------- | ----: | ------: | -------------: | ------: | ---------------------------- |
| `JWT_SECRET`     | Required    |     ✓ |       ✓ |              ✓ | **Yes** | Secret used for JWT signing. |
| `JWT_EXPIRES_IN` | Optional    |     ✓ |       ✓ |              ✓ |      No | JWT expiration period.       |
| `DOMAIN`         | Optional    |     ✓ |       ✓ |              ✓ |      No | Application domain.          |

## Redis and caching

| Variable       | Requirement | Local | CI/Test | Testnet Deploy | Secret | Description                         |
| -------------- | ----------- | ----: | ------: | -------------: | -----: | ----------------------------------- |
| `REDIS_HOST`   | Optional    |     ✓ |       ✓ |              ✓ |     No | Redis hostname.                     |
| `REDIS_PORT`   | Optional    |     ✓ |       ✓ |              ✓ |     No | Redis port.                         |
| `REDIS_URL`    | Optional    |     ✓ |       ✓ |              ✓ |     No | Redis connection URL.               |
| `CACHE_TTL_MS` | Optional    |     ✓ |       ✓ |              ✓ |     No | Cache time-to-live in milliseconds. |

## Rate limiting

| Variable                              | Requirement | Secret | Description                                      |
| ------------------------------------- | ----------- | -----: | ------------------------------------------------ |
| `RATE_LIMIT_TRACK_BY_IP`              | Optional    |     No | Enables IP-based rate-limit tracking.            |
| `RATE_LIMIT_TRACK_BY_API_KEY`         | Optional    |     No | Enables API-key-based rate-limit tracking.       |
| `RATE_LIMIT_API_KEY_HEADER`           | Optional    |     No | HTTP header used for API-key tracking.           |
| `RATE_LIMIT_REDIS_URL`                | Optional    |     No | Redis URL used for rate limiting.                |
| `RATE_LIMIT_REDIS_NAMESPACE`          | Optional    |     No | Redis namespace for rate-limit data.             |
| `RATE_LIMIT_GLOBAL_LIMIT`             | Optional    |     No | Global request limit.                            |
| `RATE_LIMIT_GLOBAL_TTL_MS`            | Optional    |     No | Global rate-limit window.                        |
| `RATE_LIMIT_GLOBAL_BLOCK_MS`          | Optional    |     No | Global block duration.                           |
| `RATE_LIMIT_AUTH_LIMIT`               | Optional    |     No | Authentication endpoint request limit.           |
| `RATE_LIMIT_AUTH_TTL_MS`              | Optional    |     No | Authentication rate-limit window.                |
| `RATE_LIMIT_AUTH_BLOCK_MS`            | Optional    |     No | Authentication block duration.                   |
| `RATE_LIMIT_PORTFOLIO_READ_LIMIT`     | Optional    |     No | Portfolio read limit.                            |
| `RATE_LIMIT_PORTFOLIO_READ_TTL_MS`    | Optional    |     No | Portfolio read window.                           |
| `RATE_LIMIT_PORTFOLIO_READ_BLOCK_MS`  | Optional    |     No | Portfolio read block duration.                   |
| `RATE_LIMIT_PORTFOLIO_WRITE_LIMIT`    | Optional    |     No | Portfolio write limit.                           |
| `RATE_LIMIT_PORTFOLIO_WRITE_TTL_MS`   | Optional    |     No | Portfolio write window.                          |
| `RATE_LIMIT_PORTFOLIO_WRITE_BLOCK_MS` | Optional    |     No | Portfolio write block duration.                  |
| `RATE_LIMIT_WATCHLIST_READ_LIMIT`     | Optional    |     No | Watchlist read limit.                            |
| `RATE_LIMIT_WATCHLIST_READ_TTL_MS`    | Optional    |     No | Watchlist read window.                           |
| `RATE_LIMIT_WATCHLIST_READ_BLOCK_MS`  | Optional    |     No | Watchlist read block duration.                   |
| `RATE_LIMIT_WATCHLIST_WRITE_LIMIT`    | Optional    |     No | Watchlist write limit.                           |
| `RATE_LIMIT_WATCHLIST_WRITE_TTL_MS`   | Optional    |     No | Watchlist write window.                          |
| `RATE_LIMIT_WATCHLIST_WRITE_BLOCK_MS` | Optional    |     No | Watchlist write block duration.                  |
| `RATE_LIMIT_NEWS_READ_LIMIT`          | Optional    |     No | News read limit.                                 |
| `RATE_LIMIT_NEWS_READ_TTL_MS`         | Optional    |     No | News read window.                                |
| `RATE_LIMIT_NEWS_READ_BLOCK_MS`       | Optional    |     No | News read block duration.                        |
| `RATE_LIMIT_PROJECT_READ_LIMIT`       | Optional    |     No | Project read limit.                              |
| `RATE_LIMIT_PROJECT_READ_TTL_MS`      | Optional    |     No | Project read window.                             |
| `RATE_LIMIT_PROJECT_READ_BLOCK_MS`    | Optional    |     No | Project read block duration.                     |
| `RATE_LIMIT_CROWDFUND_READ_LIMIT`     | Optional    |     No | Crowdfund read limit.                            |
| `RATE_LIMIT_CROWDFUND_READ_TTL_MS`    | Optional    |     No | Crowdfund read window.                           |
| `RATE_LIMIT_CROWDFUND_READ_BLOCK_MS`  | Optional    |     No | Crowdfund read block duration.                   |
| `RATE_LIMIT_STELLAR_READ_LIMIT`       | Optional    |     No | Stellar read limit.                              |
| `RATE_LIMIT_STELLAR_READ_TTL_MS`      | Optional    |     No | Stellar read window.                             |
| `RATE_LIMIT_STELLAR_READ_BLOCK_MS`    | Optional    |     No | Stellar read block duration.                     |
| `RATE_LIMIT_SEARCH_READ_LIMIT`        | Optional    |     No | Search read limit.                               |
| `RATE_LIMIT_SEARCH_READ_TTL_MS`       | Optional    |     No | Search read window.                              |
| `RATE_LIMIT_SEARCH_READ_BLOCK_MS`     | Optional    |     No | Search read block duration.                      |
| `RATE_LIMIT_ANALYTICS_READ_LIMIT`     | Optional    |     No | Analytics read limit.                            |
| `RATE_LIMIT_ANALYTICS_READ_TTL_MS`    | Optional    |     No | Analytics read window.                           |
| `RATE_LIMIT_ANALYTICS_READ_BLOCK_MS`  | Optional    |     No | Analytics read block duration.                   |
| `IP_ALLOWLIST`                        | Optional    |     No | IP addresses/CIDRs permitted by the application. |
| `IP_DENYLIST`                         | Optional    |     No | IP addresses/CIDRs denied by the application.    |

## Stellar / Soroban

| Variable                  | Requirement | Local | CI/Test | Testnet Deploy |  Secret | Description                                                 |
| ------------------------- | ----------- | ----: | ------: | -------------: | ------: | ----------------------------------------------------------- |
| `STELLAR_NETWORK`         | Required    |     ✓ |       ✓ |              ✓ |      No | Stellar network identifier.                                 |
| `STELLAR_HORIZON_URL`     | Required    |     ✓ |       ✓ |              ✓ |      No | Stellar Horizon endpoint.                                   |
| `STELLAR_SOROBAN_RPC_URL` | Required    |     ✓ |       ✓ |              ✓ |      No | Soroban RPC endpoint.                                       |
| `STELLAR_RPC_URL`         | Optional    |     ✓ |       ✓ |              ✓ |      No | Soroban RPC endpoint used by network-context configuration. |
| `HORIZON_URL`             | Optional    |     ✓ |       ✓ |              ✓ |      No | Horizon endpoint used by tooling.                           |
| `STELLAR_TIMEOUT`         | Optional    |     ✓ |       ✓ |              ✓ |      No | Stellar request timeout in milliseconds.                    |
| `STELLAR_RETRY_ATTEMPTS`  | Optional    |     ✓ |       ✓ |              ✓ |      No | Number of Stellar request retries.                          |
| `STELLAR_RETRY_DELAY`     | Optional    |     ✓ |       ✓ |              ✓ |      No | Delay between Stellar retries.                              |
| `STELLAR_SERVER_SECRET`   | Required    |     ✓ |       ✓ |              ✓ | **Yes** | Stellar server secret used by the backend.                  |

## Stellar contract configuration

| Variable                                | Requirement | Local | CI/Test | Testnet Deploy | Secret | Description                                                   |
| --------------------------------------- | ----------- | ----: | ------: | -------------: | -----: | ------------------------------------------------------------- |
| `STELLAR_CONTRACT_LUMEN_TOKEN`          | Optional    |     ✓ |       ✓ |              ✓ |     No | LumenToken contract ID.                                       |
| `STELLAR_CONTRACT_CROWDFUND_VAULT`      | Optional    |     ✓ |       ✓ |              ✓ |     No | Crowdfund Vault contract ID.                                  |
| `STELLAR_CONTRACT_PROJECT_REGISTRY`     | Optional    |     ✓ |       ✓ |              ✓ |     No | Project Registry contract ID.                                 |
| `STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY` | Optional    |     ✓ |       ✓ |              ✓ |     No | Contributor Registry contract ID.                             |
| `STELLAR_CONTRACT_MATCHING_POOL`        | Optional    |     ✓ |       ✓ |              ✓ |     No | Matching Pool contract ID.                                    |
| `STELLAR_CONTRACT_TREASURY`             | Optional    |     ✓ |       ✓ |              ✓ |     No | Treasury contract ID.                                         |
| `CONTRIBUTOR_REGISTRY_CONTRACT_ID`      | Optional    |     ✓ |       ✓ |              ✓ |     No | Contributor Registry contract ID used by the network context. |
| `PROJECT_REGISTRY_CONTRACT_ID`          | Optional    |     ✓ |       ✓ |              ✓ |     No | Project Registry contract ID used by the network context.     |
| `CROWDFUND_VAULT_CONTRACT_ID`           | Optional    |     ✓ |       ✓ |              ✓ |     No | Crowdfund Vault contract ID used by the network context.      |
| `MATCHING_POOL_CONTRACT_ID`             | Optional    |     ✓ |       ✓ |              ✓ |     No | Matching Pool contract ID used by the network context.        |
| `TREASURY_CONTRACT_ID`                  | Optional    |     ✓ |       ✓ |              ✓ |     No | Treasury contract ID used by the network context.             |
| `LUMEN_TOKEN_CONTRACT_ID`               | Optional    |     ✓ |       ✓ |              ✓ |     No | LumenToken contract ID used by the network context.           |
| `PRICING_ADAPTER_CONTRACT_ID`           | Optional    |     ✓ |       ✓ |              ✓ |     No | Pricing Adapter contract ID.                                  |

## Health checks

| Variable                                  | Requirement | Secret | Description                                         |
| ----------------------------------------- | ----------- | -----: | --------------------------------------------------- |
| `HEALTH_HORIZON_LATENCY_DEGRADED_MS`      | Optional    |     No | Horizon latency threshold for degraded status.      |
| `HEALTH_HORIZON_LATENCY_HARD_DOWN_MS`     | Optional    |     No | Horizon latency threshold for hard-down status.     |
| `HEALTH_SOROBAN_RPC_LATENCY_DEGRADED_MS`  | Optional    |     No | Soroban RPC latency threshold for degraded status.  |
| `HEALTH_SOROBAN_RPC_LATENCY_HARD_DOWN_MS` | Optional    |     No | Soroban RPC latency threshold for hard-down status. |

## Python/data-processing integration

| Variable             | Requirement |  Secret | Description                                     |
| -------------------- | ----------- | ------: | ----------------------------------------------- |
| `PYTHON_API_URL`     | Optional    |      No | Data-processing API URL.                        |
| `PYTHON_SERVICE_URL` | Optional    |      No | Data-processing service URL.                    |
| `PYTHON_API_KEY`     | Conditional | **Yes** | API key for the Python/data-processing service. |
| `COINDESK_API_KEY`   | Conditional | **Yes** | CoinDesk API key.                               |

## Soroban event ingestion

| Variable                         | Requirement |  Secret | Description                                                |
| -------------------------------- | ----------- | ------: | ---------------------------------------------------------- |
| `SOROBAN_INGEST_SECRET`          | Conditional | **Yes** | HMAC-SHA256 secret used for Soroban event ingestion.       |
| `SOROBAN_TIMESTAMP_TOLERANCE_MS` | Optional    |      No | Timestamp tolerance for replay protection.                 |
| `SOROBAN_INDEXER_START_LEDGER`   | Optional    |      No | Ledger sequence from which direct Soroban indexing starts. |

## Webhooks and notifications

| Variable              | Requirement |  Secret | Description                                                                 |
| --------------------- | ----------- | ------: | --------------------------------------------------------------------------- |
| `WEBHOOK_SECRET`      | Conditional | **Yes** | Legacy single-webhook authentication secret.                                |
| `WEBHOOK_PROVIDERS`   | Conditional | **Yes** | JSON configuration for webhook providers and their authentication material. |
| `TELEGRAM_BOT_TOKEN`  | Conditional | **Yes** | Telegram bot authentication token.                                          |
| `METRICS_ALLOWED_IPS` | Optional    |      No | IP allowlist for the `/metrics` endpoint.                                   |

Notification-specific variables:

| Variable                                  | Requirement |  Secret | Description                                       |
| ----------------------------------------- | ----------- | ------: | ------------------------------------------------- |
| `NOTIFICATION_DEFAULT_CHANNELS`           | Optional    |      No | Default notification channels.                    |
| `NOTIFICATION_DEFAULT_DAILY_LIMIT`        | Optional    |      No | Maximum notifications per user per day.           |
| `NOTIFICATION_EMAIL_ENABLED`              | Optional    |      No | Enables email notifications.                      |
| `EMAIL_SERVICE_PROVIDER`                  | Conditional |      No | Email service provider.                           |
| `SENDGRID_API_KEY`                        | Conditional | **Yes** | SendGrid authentication key.                      |
| `EMAIL_FROM`                              | Conditional |      No | Email sender address.                             |
| `NOTIFICATION_PUSH_ENABLED`               | Optional    |      No | Enables push notifications.                       |
| `FIREBASE_PROJECT_ID`                     | Conditional |      No | Firebase project identifier.                      |
| `FIREBASE_PRIVATE_KEY`                    | Conditional | **Yes** | Firebase private key.                             |
| `FIREBASE_CLIENT_EMAIL`                   | Conditional |      No | Firebase service-account client email.            |
| `NOTIFICATION_SMS_ENABLED`                | Optional    |      No | Enables SMS notifications.                        |
| `TWILIO_ACCOUNT_SID`                      | Conditional | **Yes** | Twilio account identifier.                        |
| `TWILIO_AUTH_TOKEN`                       | Conditional | **Yes** | Twilio authentication token.                      |
| `TWILIO_PHONE_NUMBER`                     | Conditional |      No | Twilio sender phone number.                       |
| `NOTIFICATION_WEBHOOK_ENABLED`            | Optional    |      No | Enables notification webhooks.                    |
| `NOTIFICATION_WEBHOOK_TIMEOUT_MS`         | Optional    |      No | Notification webhook timeout.                     |
| `NOTIFICATION_WEBHOOK_MAX_RETRIES`        | Optional    |      No | Maximum webhook delivery retries.                 |
| `NOTIFICATION_DELIVERY_RETRY_MAX`         | Optional    |      No | Maximum notification delivery retries.            |
| `NOTIFICATION_DELIVERY_RETRY_DELAY_MS`    | Optional    |      No | Notification retry delay.                         |
| `NOTIFICATION_QUIET_HOURS_START`          | Optional    |      No | Default quiet-hours start.                        |
| `NOTIFICATION_QUIET_HOURS_END`            | Optional    |      No | Default quiet-hours end.                          |
| `NOTIFICATION_QUIET_HOURS_ALLOW_CRITICAL` | Optional    |      No | Allows critical notifications during quiet hours. |

## Runtime and logging

| Variable                      | Requirement | Secret | Description                              |
| ----------------------------- | ----------- | -----: | ---------------------------------------- |
| `USE_MOCK_TRANSACTIONS`       | Optional    |     No | Enables mock transaction behavior.       |
| `BOOTSTRAP_DEMO_DATA_ENABLED` | Optional    |     No | Enables demo-data bootstrapping.         |
| `LOGGING_ENABLED`             | Optional    |     No | Enables application logging.             |
| `LOGGING_LEVEL`               | Optional    |     No | Logging level.                           |
| `LOGGING_INCLUDE_BODY`        | Optional    |     No | Includes request bodies in logs.         |
| `LOGGING_INCLUDE_RESPONSE`    | Optional    |     No | Includes responses in logs.              |
| `LOGGING_INCLUDE_IP`          | Optional    |     No | Includes client IP addresses in logs.    |
| `LOGGING_INCLUDE_USER_AGENT`  | Optional    |     No | Includes user-agent information in logs. |
| `LOGGING_EXCLUDE_ROUTES`      | Optional    |     No | Routes excluded from logging.            |

## AWS / S3 uploads

| Variable                | Requirement |  Secret | Description                |
| ----------------------- | ----------- | ------: | -------------------------- |
| `AWS_BUCKET_NAME`       | Conditional |      No | S3 bucket used for assets. |
| `AWS_REGION`            | Conditional |      No | AWS region.                |
| `AWS_ACCESS_KEY_ID`     | Conditional | **Yes** | AWS access key ID.         |
| `AWS_SECRET_ACCESS_KEY` | Conditional | **Yes** | AWS secret access key.     |

## Frontend and workers

| Variable                            | Requirement | Secret | Description                            |
| ----------------------------------- | ----------- | -----: | -------------------------------------- |
| `FRONTEND_URL`                      | Optional    |     No | Frontend URL used by the backend.      |
| `PORTFOLIO_SNAPSHOT_CONCURRENCY`    | Optional    |     No | Portfolio snapshot worker concurrency. |
| `PORTFOLIO_SNAPSHOT_BATCH_SIZE`     | Optional    |     No | Portfolio snapshot batch size.         |
| `PORTFOLIO_SNAPSHOT_ATTEMPTS`       | Optional    |     No | Portfolio snapshot retry attempts.     |
| `PORTFOLIO_SNAPSHOT_RETRY_DELAY_MS` | Optional    |     No | Portfolio snapshot retry delay.        |
| `PORTFOLIO_SNAPSHOT_QUEUE_METRICS`  | Optional    |     No | Enables portfolio queue metrics.       |

---

# 2. Webapp

**Configuration source:** `apps/webapp/.env.local.example` and environment references in the web application.

| Variable                           | Requirement | Local | CI/Test | Testnet Deploy | Secret | Description                                             |
| ---------------------------------- | ----------- | ----: | ------: | -------------: | -----: | ------------------------------------------------------- |
| `BACKEND_API_URL`                  | Optional    |     ✓ |       ✓ |              ✓ |     No | Server-side backend API URL used by Next.js API routes. |
| `NEXT_PUBLIC_API_URL`              | Optional    |     ✓ |       ✓ |              ✓ |     No | Public API URL available to client-side code.           |
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | Optional    |     ✓ |       ✓ |              ✓ |     No | Stellar Explorer base URL used to generate links.       |

### Webapp notes

`BACKEND_API_URL` is intentionally not prefixed with `NEXT_PUBLIC_` because it is intended for server-side use.

Variables prefixed with `NEXT_PUBLIC_` are exposed to client-side application code and therefore **must not contain secrets**.

---

# 3. Mobile

**Configuration source:** `apps/mobile/.env.example` and environment references in the mobile application.

| Variable                                    | Requirement | Local | CI/Test | Testnet Deploy | Secret | Description                                                              |
| ------------------------------------------- | ----------- | ----: | ------: | -------------: | -----: | ------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`                       | Required    |     ✓ |       ✓ |              ✓ |     No | Default public backend API URL.                                          |
| `EXPO_PUBLIC_TESTNET_API_URL`               | Optional    |     ✓ |       ✓ |              ✓ |     No | Testnet backend API URL.                                                 |
| `EXPO_PUBLIC_MAINNET_API_URL`               | Optional    |     — |       ✓ |              — |     No | Mainnet API URL; intentionally separate until mainnet is enabled in-app. |
| `EXPO_PUBLIC_APP_VARIANT`                   | Optional    |     ✓ |       ✓ |              — |     No | Expo application variant.                                                |
| `EXPO_PUBLIC_STELLAR_NETWORK`               | Required    |     ✓ |       ✓ |              ✓ |     No | Stellar network selected by the mobile application.                      |
| `EXPO_PUBLIC_SOROBAN_RPC_URL`               | Required    |     ✓ |       ✓ |              ✓ |     No | Soroban RPC endpoint.                                                    |
| `EXPO_PUBLIC_CROWDFUND_CONTRACT_ID`         | Optional    |     ✓ |       ✓ |              ✓ |     No | Default Crowdfund contract ID.                                           |
| `EXPO_PUBLIC_STELLAR_EXPLORER_URL`          | Optional    |     ✓ |       ✓ |              ✓ |     No | Stellar Explorer URL.                                                    |
| `EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL`       | Optional    |     ✓ |       ✓ |              ✓ |     No | Testnet Soroban RPC endpoint.                                            |
| `EXPO_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID` | Optional    |     ✓ |       ✓ |              ✓ |     No | Testnet Crowdfund contract ID.                                           |
| `EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL`       | Optional    |     — |       ✓ |              — |     No | Mainnet Soroban RPC endpoint.                                            |
| `EXPO_PUBLIC_MAINNET_CROWDFUND_CONTRACT_ID` | Optional    |     — |       ✓ |              — |     No | Mainnet Crowdfund contract ID.                                           |

### Mobile security note

All `EXPO_PUBLIC_*` variables should be treated as **public configuration**. Do not put private keys, API secrets, passwords, or other credentials in these variables.

---

# 4. Data Processing

**Configuration source:** `apps/data-processing/.env.example` and environment references in the data-processing application.

## Runtime and database

| Variable              | Requirement | Local | CI/Test | Testnet Deploy |                   Secret | Description                                            |
| --------------------- | ----------- | ----: | ------: | -------------: | -----------------------: | ------------------------------------------------------ |
| `RUN_IMMEDIATELY`     | Optional    |     ✓ |       ✓ |              — |                       No | Runs the analyzer immediately on startup when enabled. |
| `LOG_LEVEL`           | Optional    |     ✓ |       ✓ |              — |                       No | Application logging level.                             |
| `DATA_RETENTION_DAYS` | Optional    |     ✓ |       ✓ |              — |                       No | Number of days analytics data is retained.             |
| `DATABASE_URL`        | Required    |     ✓ |       ✓ |              — | **Contains credentials** | PostgreSQL connection URL.                             |
| `DB_HOST`             | Required    |     ✓ |       ✓ |              — |                       No | PostgreSQL hostname.                                   |
| `DB_PORT`             | Required    |     ✓ |       ✓ |              — |                       No | PostgreSQL port.                                       |
| `DB_NAME`             | Required    |     ✓ |       ✓ |              — |                       No | PostgreSQL database name.                              |
| `DB_USER`             | Required    |     ✓ |       ✓ |              — |                       No | PostgreSQL username.                                   |
| `DB_PASSWORD`         | Required    |     ✓ |       ✓ |              — |                  **Yes** | PostgreSQL password.                                   |

## External APIs

| Variable                | Requirement | Local | CI/Test | Testnet Deploy |  Secret | Description                 |
| ----------------------- | ----------- | ----: | ------: | -------------: | ------: | --------------------------- |
| `CRYPTOCOMPARE_API_KEY` | Conditional |     ✓ |       ✓ |              — | **Yes** | CryptoCompare API key.      |
| `NEWSAPI_API_KEY`       | Conditional |     ✓ |       ✓ |              — | **Yes** | NewsAPI API key.            |
| `TWITTER_BEARER_TOKEN`  | Conditional |     ✓ |       ✓ |              — | **Yes** | Twitter/X API bearer token. |
| `COINGECKO_API_KEY`     | Conditional |     ✓ |       ✓ |              — | **Yes** | CoinGecko API key.          |

## Telegram and alerts

| Variable              | Requirement |      Secret | Description                         |
| --------------------- | ----------- | ----------: | ----------------------------------- |
| `TELEGRAM_BOT_TOKEN`  | Conditional |     **Yes** | Telegram bot token.                 |
| `TELEGRAM_CHANNEL_ID` | Conditional |          No | Telegram channel identifier.        |
| `ALERT_WEBHOOK_URL`   | Conditional | Potentially | Alert webhook endpoint.             |
| `ALERT_WEBHOOK_URLS`  | Optional    | Potentially | Additional alert webhook endpoints. |
| `ALERT_MIN_SEVERITY`  | Optional    |          No | Minimum alert severity.             |

## Redis and API security

| Variable             | Requirement |  Secret | Description                |
| -------------------- | ----------- | ------: | -------------------------- |
| `REDIS_HOST`         | Optional    |      No | Redis hostname.            |
| `REDIS_PORT`         | Optional    |      No | Redis port.                |
| `REDIS_DB`           | Optional    |      No | Redis database number.     |
| `CACHE_TTL_SECONDS`  | Optional    |      No | Cache lifetime in seconds. |
| `API_KEY`            | Conditional | **Yes** | API authentication key.    |
| `RATE_LIMIT_DEFAULT` | Optional    |      No | Default rate limit.        |
| `RATE_LIMIT_STRICT`  | Optional    |      No | Strict rate limit.         |
| `RATE_LIMIT_ENABLED` | Optional    |      No | Enables rate limiting.     |

## Network

| Variable          | Requirement | Secret | Description                                              |
| ----------------- | ----------- | -----: | -------------------------------------------------------- |
| `NETWORK`         | Optional    |     No | Network selection; example configuration uses `mainnet`. |
| `SOROBAN_RPC_URL` | Optional    |     No | Soroban RPC endpoint.                                    |
| `STELLAR_NETWORK` | Optional    |     No | Stellar network identifier.                              |

## Analytics and ingestion

The following variables are used by the data-processing code but are not all represented in the `.env.example` file.

| Variable                           | Requirement | Secret | Description                       |
| ---------------------------------- | ----------- | -----: | --------------------------------- |
| `ANALYTICS_JSONL_PATH`             | Optional    |     No | Analytics JSONL output path.      |
| `CRYPTO_SLANG_LEXICON`             | Optional    |     No | Crypto slang lexicon path.        |
| `MODEL_REGISTRY_PATH`              | Optional    |     No | Model registry path.              |
| `MANUAL_RUN_ID`                    | Optional    |     No | Manual processing run identifier. |
| `ONCHAIN_ASSET`                    | Optional    |     No | On-chain asset identifier.        |
| `INGESTION_ALERT_INTERVAL_MINUTES` | Optional    |     No | Ingestion alert interval.         |
| `INGESTION_LAG_SECONDS`            | Optional    |     No | Ingestion lag threshold.          |
| `INGESTION_REPORT_DIR`             | Optional    |     No | Ingestion report directory.       |
| `WEBHOOK_BACKOFF_SECONDS`          | Optional    |     No | Webhook retry backoff.            |
| `WEBHOOK_MAX_RETRIES`              | Optional    |     No | Maximum webhook retries.          |

## Drift detection

| Variable                       | Requirement | Secret | Description                                              |
| ------------------------------ | ----------- | -----: | -------------------------------------------------------- |
| `DRIFT_COMPARE_WINDOW_HOURS`   | Optional    |     No | Drift comparison window.                                 |
| `DRIFT_HOURS_LIST`             | Optional    |     No | Comma-separated drift analysis windows.                  |
| `DRIFT_RATIO_THRESHOLD`        | Optional    |     No | Drift ratio threshold.                                   |
| `DUPLICATE_WINDOW_HOURS`       | Optional    |     No | Duplicate-detection time window.                         |
| `METADATA_DRIFT_PROJECT_LIMIT` | Optional    |     No | Maximum projects considered for metadata drift analysis. |

## Price and sentiment thresholds

| Variable                 | Requirement | Secret | Description                           |
| ------------------------ | ----------- | -----: | ------------------------------------- |
| `MIN_PRICE_R2`           | Optional    |     No | Minimum price-model R² threshold.     |
| `MIN_SENTIMENT_COVERAGE` | Optional    |     No | Minimum sentiment coverage threshold. |

## Round anomaly detection

| Variable                              | Requirement | Secret | Description                                          |
| ------------------------------------- | ----------- | -----: | ---------------------------------------------------- |
| `ROUND_CONCENTRATION_THRESHOLD`       | Optional    |     No | Threshold for allocation concentration anomalies.    |
| `ROUND_GINI_THRESHOLD`                | Optional    |     No | Gini coefficient threshold for inequality detection. |
| `ROUND_SINGLE_CONTRIBUTION_THRESHOLD` | Optional    |     No | Maximum ratio allowed from a single contributor.     |
| `ROUND_MIN_CONTRIBUTORS`              | Optional    |     No | Minimum unique contributors required for a project.  |
| `ROUND_TIMING_WINDOW_HOURS`           | Optional    |     No | Timing-cluster analysis window.                      |
| `ROUND_TIMING_THRESHOLD`              | Optional    |     No | Maximum ratio allowed within the timing window.      |

## Machine-learning anomaly detection

| Variable                   | Requirement | Secret | Description                            |
| -------------------------- | ----------- | -----: | -------------------------------------- |
| `ANOMALY_COMPARISON_MODE`  | Optional    |     No | Enables anomaly comparison mode.       |
| `ANOMALY_ML_CONTAMINATION` | Optional    |     No | ML anomaly contamination parameter.    |
| `ANOMALY_ML_ENABLED`       | Optional    |     No | Enables ML-based anomaly detection.    |
| `ANOMALY_ML_ESTIMATORS`    | Optional    |     No | Number of ML estimators.               |
| `ANOMALY_MODEL_PATH`       | Optional    |     No | Anomaly detector model path.           |
| `ANOMALY_WINDOW_HOURS`     | Optional    |     No | Anomaly analysis window.               |
| `ANOMALY_Z_THRESHOLD`      | Optional    |     No | Statistical anomaly Z-score threshold. |

## Reputation and timing configuration

| Variable                    | Requirement | Secret | Description                                                  |
| --------------------------- | ----------- | -----: | ------------------------------------------------------------ |
| `REPUTATION_SNAPSHOT_TOP_N` | Optional    |     No | Number of top contributors included in reputation snapshots. |

The application also reads dynamic environment variables matching:

```text
<NAME>_CRITICAL_SECONDS
<NAME>_WARNING_SECONDS
```

where `<NAME>` is determined by the relevant configuration prefix in the application.

---

# 5. Onchain / Deployment Tooling

**Configuration source:** `scripts/.env.example` and environment references in `scripts/`.

The deployment scripts use:

| Variable             | Requirement             | Local | CI/Test | Testnet Deploy |  Secret | Description                                    |
| -------------------- | ----------------------- | ----: | ------: | -------------: | ------: | ---------------------------------------------- |
| `NETWORK_PASSPHRASE` | Required                |     ✓ |       ✓ |              ✓ |      No | Stellar network passphrase.                    |
| `SOROBAN_RPC_URL`    | Required                |     ✓ |       ✓ |              ✓ |      No | Soroban RPC endpoint.                          |
| `HORIZON_URL`        | Required by tooling     |     ✓ |       ✓ |              ✓ |      No | Stellar Horizon endpoint.                      |
| `ADMIN_SECRET`       | Required for deployment |     — |       — |          **✓** | **Yes** | Stellar secret key used by deployment tooling. |

### Deployment secret handling

`ADMIN_SECRET` must contain a valid Stellar secret key when a deployment requires an administrator account.

Never commit the value to:

* Git
* `.env.example`
* documentation
* CI logs
* issue reports
* pull requests

Use a secret-management mechanism for CI or deployment environments.

---

# 6. CI / Test Configuration

The repository workflow scan did not identify explicit environment-variable or GitHub Actions secret references in `.github/workflows`.

Therefore, this document does **not** claim that specific CI secrets are currently configured.

For CI jobs that execute applications or tests, provide only the variables required by the specific test target. Values should come from CI environment configuration or secret storage rather than committed `.env` files.

Typical categories include:

* Database configuration
* JWT signing secret
* Stellar testnet configuration
* API keys required by integration tests
* Webhook secrets required by webhook tests

The exact CI values should be determined from the individual workflow and test configuration when those workflows require environment-specific settings.

---

# 7. Local Development

For local development, start from the appropriate example file rather than creating configuration from scratch.

### Backend

```bash
cp apps/backend/.env.example apps/backend/.env.local
```

Then replace only the values that require local credentials or infrastructure.

### Webapp

```bash
cp apps/webapp/.env.local.example apps/webapp/.env.local
```

### Mobile

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

### Data processing

```bash
cp apps/data-processing/.env.example apps/data-processing/.env
```

### Deployment tooling

```bash
cp scripts/.env.example scripts/.env
```

The deployment tooling `.env` must contain a valid deployment secret when `npm run deploy` is executed.

---

# 8. Testnet Deployment

The testnet deployment configuration requires Stellar/Soroban network information and deployment credentials.

At minimum, the deployment tooling expects:

```text
NETWORK_PASSPHRASE=<Stellar testnet passphrase>
SOROBAN_RPC_URL=<Soroban testnet RPC endpoint>
ADMIN_SECRET=<Stellar deployment account secret>
```

The backend may additionally require:

```text
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=<Stellar testnet Horizon endpoint>
STELLAR_SOROBAN_RPC_URL=<Stellar testnet Soroban RPC endpoint>
STELLAR_SERVER_SECRET=<backend Stellar server secret>
```

After contracts are deployed, contract IDs can be supplied through the relevant contract-ID variables.

Do not document private keys or other secret values here.

---

# 9. Contract ID Configuration

Contract IDs are identifiers, not private credentials. They may therefore be documented when they represent deployed public contracts.

The repository currently defines contract-ID variables for:

* LumenToken
* Crowdfund Vault
* Project Registry
* Contributor Registry
* Matching Pool
* Treasury
* Pricing Adapter

The backend uses both the `STELLAR_CONTRACT_*` naming scheme and the network-context `*_CONTRACT_ID` naming scheme.

When updating deployed contract configuration, ensure that the variable used by the consuming application matches the name expected by that application.

---

# 10. Secret Management Rules

The following variables must be treated as secrets or may contain credentials:

```text
DB_PASSWORD
JWT_SECRET
STELLAR_SERVER_SECRET
PYTHON_API_KEY
COINDESK_API_KEY
SOROBAN_INGEST_SECRET
WEBHOOK_SECRET
WEBHOOK_PROVIDERS
TELEGRAM_BOT_TOKEN
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
SENDGRID_API_KEY
FIREBASE_PRIVATE_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
CRYPTOCOMPARE_API_KEY
NEWSAPI_API_KEY
TWITTER_BEARER_TOKEN
COINGECKO_API_KEY
API_KEY
ADMIN_SECRET
```

`DATABASE_URL` should also be treated as sensitive when it contains embedded database credentials.

Secrets should be supplied through:

1. Local untracked environment files.
2. CI/CD secret storage.
3. Deployment-platform secret/environment configuration.
4. A dedicated secret manager where appropriate.

Never replace a placeholder in a committed `.env.example` file with a real credential.

---

# 11. Updating This Matrix

When adding a new environment variable:

1. Add the variable to the relevant application's `.env.example` when appropriate.
2. Document the variable in this matrix.
3. Identify whether it is required, optional, or conditional.
4. Identify whether it is a secret.
5. Specify which environments use it.
6. Never commit its real secret value.
7. Keep the variable name identical to the name consumed by the application.

When removing an environment variable, remove it from this document only after confirming that the application no longer references it.

When renaming a variable, update both the application and this document together.

---

# 12. Source Files

The environment definitions documented here were collected from the repository's existing configuration examples and source-code environment-variable references.

Primary configuration files:

```text
apps/backend/.env.example
apps/backend/.env.metrics.example
apps/backend/.env.webhook-notification.example
apps/data-processing/.env.example
apps/mobile/.env.example
apps/webapp/.env.local.example
scripts/.env.example
```

Environment references were also identified in the TypeScript/JavaScript and Python application code under:

```text
apps/backend
apps/webapp
apps/mobile
apps/data-processing
scripts
```

This document intentionally does not expose real secret values.

