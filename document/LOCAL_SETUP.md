# LumenPulse — Local Development Setup

This is the single source of truth for running the full LumenPulse stack locally. Follow it top to bottom on a fresh machine and you will have every service running within one session.

---

## Table of Contents

1. [Stack Overview](#1-stack-overview)
2. [Prerequisites](#2-prerequisites)
3. [Repository Setup](#3-repository-setup)
4. [Infrastructure (Docker)](#4-infrastructure-docker)
5. [Environment Variables](#5-environment-variables)
6. [Wallet Setup (Freighter)](#6-wallet-setup-freighter)
7. [Service Startup Order](#7-service-startup-order)
   - [Backend API](#71-backend-api)
   - [Data Processing Service](#72-data-processing-service)
   - [Web App](#73-web-app)
   - [Mobile App (optional)](#74-mobile-app-optional)
   - [Soroban Contracts](#75-soroban-contracts)
8. [Seeded / Test Data](#8-seeded--test-data)
9. [Running Tests](#9-running-tests)
10. [Common Failures and Recovery](#10-common-failures-and-recovery)
11. [Port Reference](#11-port-reference)

---

## 1. Stack Overview

| Layer | Technology | Location |
|---|---|---|
| Web app | Next.js 13 + React 18 + TypeScript | `apps/webapp` |
| Backend API | NestJS + TypeORM + PostgreSQL | `apps/backend` |
| Data processing | Python + FastAPI + uvicorn | `apps/data-processing` |
| Smart contracts | Rust + Soroban SDK v23 | `apps/onchain` |
| Mobile app | Expo + React Native (optional) | `apps/mobile` |
| Infrastructure | PostgreSQL 16, Redis 7 via Docker | `docker-compose.yml` |

The monorepo root uses **pnpm workspaces** and **TurboRepo** to coordinate JS/TS builds.

---

## 2. Prerequisites

Install every tool below before continuing.

### Node.js and pnpm

```bash
# Node.js 18 or later (https://nodejs.org)
node --version   # must print v18.x or higher

# pnpm (package manager used by this repo)
npm install -g pnpm
pnpm --version
```

### Python

```bash
# Python 3.9 or later (https://python.org)
python3 --version   # must print 3.9 or higher
pip3 --version
```

### Rust and WebAssembly target

```bash
# Install Rust via rustup (https://rustup.rs)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Add the WASM compilation target required by Soroban
rustup target add wasm32-unknown-unknown

# Verify
rustc --version
cargo --version
```

### Soroban CLI

```bash
cargo install --locked soroban-cli

# Verify
soroban --version
```

### Docker and Docker Compose

PostgreSQL and Redis run inside Docker to avoid local installation conflicts.

```bash
# https://docs.docker.com/get-docker/
docker --version
docker compose version
```

### Git

```bash
git --version
```

### (Optional) Expo CLI — only needed for the mobile app

```bash
npm install -g expo-cli
```

---

## 3. Repository Setup

```bash
git clone https://github.com/Pulsefy/Lumenpulse.git
cd Lumenpulse

# Install all JS/TS workspace dependencies
pnpm install
```

---

## 4. Infrastructure (Docker)

Start PostgreSQL and Redis before any application service:

```bash
# From the repository root
docker compose up -d postgres redis
```

Verify they are healthy:

```bash
docker compose ps
# Both postgres and redis should show "healthy"
```

The compose file exposes:

| Service | Host port | Container port |
|---|---|---|
| PostgreSQL | `5433` | `5432` |
| Redis | `6379` | `6379` |

> **Why 5433?** The host port is `5433` to avoid clashing with any PostgreSQL instance you may already have running on `5432`. The backend env vars use `DB_PORT=5433` to match.

---

## 5. Environment Variables

Each service needs its own `.env` file. Copy the example files and fill in the values marked **CHANGE ME**.  
Never commit real secret values.

### 5.1 Backend (`apps/backend/.env`)

```bash
cp apps/backend/.env.example apps/backend/.env
```

Minimum values to change:

```env
# ── Secrets (required, no defaults) ──────────────────────────────────
DB_PASSWORD=lumenpulse                       # matches Docker compose POSTGRES_PASSWORD
JWT_SECRET=change-me-use-a-long-random-string
STELLAR_SERVER_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# ── Config ────────────────────────────────────────────────────────────
PORT=3001
DB_HOST=localhost
DB_PORT=5433                                 # matches Docker host port
DB_USERNAME=lumenpulse
DB_DATABASE=lumenpulse

# ── Optional but useful locally ───────────────────────────────────────
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
PYTHON_API_URL=http://localhost:8000
PYTHON_SERVICE_URL=http://localhost:8000
PYTHON_API_KEY=local-dev-key
USE_MOCK_TRANSACTIONS=true
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:8081
FRONTEND_URL=http://localhost:3000
```

All other variables in `.env.example` are optional for local development. Leave them as the placeholder values shown in the file.

### 5.2 Web App (`apps/webapp/.env.local`)

```bash
cp apps/webapp/.env.local.example apps/webapp/.env.local
```

```env
BACKEND_API_URL=http://localhost:3001
```

That is the only variable needed to run the web app locally.

### 5.3 Data Processing (`apps/data-processing/.env`)

```bash
cp apps/data-processing/.env.example apps/data-processing/.env
```

Minimum values to change:

```env
DATABASE_URL=postgresql://lumenpulse:lumenpulse@localhost:5433/lumenpulse
DB_HOST=localhost
DB_PORT=5433
DB_NAME=lumenpulse
DB_USER=lumenpulse
DB_PASSWORD=lumenpulse

# Logging
LOG_LEVEL=INFO

# API security key (must match PYTHON_API_KEY in the backend .env)
API_KEY=local-dev-key

# Optional — external API keys for live data; omit to use stubs
CRYPTOCOMPARE_API_KEY=your_key_here
NEWSAPI_API_KEY=your_key_here
```

### 5.4 Mobile App (`apps/mobile/.env`)

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

```env
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_APP_VARIANT=development
EXPO_PUBLIC_STELLAR_NETWORK=testnet
EXPO_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### 5.5 Scripts / Contract Deployment (`scripts/.env`)

```bash
cp scripts/.env.example scripts/.env
```

```env
NETWORK_PASSPHRASE="Test SDA Network ; September 2015"
RPC_URL="https://soroban-testnet.stellar.org"
ADMIN_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   # CHANGE ME
```

---

## 6. Wallet Setup (Freighter)

Freighter is the browser wallet used for Stellar/Soroban authentication and transaction signing.

1. Install the Freighter browser extension from [freighter.app](https://freighter.app).
2. Create a new wallet and save the seed phrase somewhere secure (this is your dev wallet only; never use a wallet holding real funds).
3. Switch the network to **Testnet**: Settings → Network → Testnet.
4. Fund the testnet wallet with fake XLM:
   - Open [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#?network=test).
   - Paste your **G...** public key and click **Get test network lumens**.
   - The wallet should receive 10,000 XLM for testing.
5. Copy the **S...** secret key from Freighter (Settings → Show secret key) and paste it as:
   - `STELLAR_SERVER_SECRET` in `apps/backend/.env`
   - `ADMIN_SECRET` in `scripts/.env`

> Keep secret keys out of version control. The `.gitignore` already excludes `.env` and `.env.local` files.

---

## 7. Service Startup Order

Start services in this order to satisfy dependencies.

```
Docker (postgres + redis)  →  Backend API  →  Data Processing  →  Web App
```

Smart contract deployment is a one-time step and can happen at any point after the Soroban CLI is installed.

### 7.1 Backend API

```bash
cd apps/backend
npm install          # if you skipped pnpm install at the root
npm run migration:run   # apply database migrations
npm run start:dev    # starts NestJS on http://localhost:3001 with hot reload
```

Confirm it is running:

```
GET http://localhost:3001/health
# → { "status": "ok" }

Swagger UI: http://localhost:3001/api/docs
```

### 7.2 Data Processing Service

```bash
cd apps/data-processing

# Create and activate Python virtual environment
python3 -m venv venv
source venv/bin/activate          # Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Apply database migrations (Alembic)
alembic upgrade head

# Start the FastAPI server on http://localhost:8000
python start_api.py
```

Confirm it is running:

```
GET http://localhost:8000/health
# → { "status": "healthy" }
```

### 7.3 Web App

```bash
cd apps/webapp
npm run dev    # starts Next.js on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) in a browser. Connect the Freighter wallet when prompted.

### 7.4 Mobile App (optional)

```bash
cd apps/mobile
pnpm install
pnpm start        # starts Expo dev server

# Then press:
#   a  → Android Emulator
#   i  → iOS Simulator
#   w  → Web
#   Scan the QR code with Expo Go on a physical device
```

### 7.5 Soroban Contracts

Build and optionally deploy the contracts to Stellar testnet.

```bash
cd apps/onchain

# Build all contracts
cargo build --target wasm32-unknown-unknown --release

# Run unit tests
cargo test --workspace

# Deploy a single contract (example: lumen_token)
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumen_token.wasm \
  --network testnet \
  --source <your-stellar-secret-key>
```

The deploy command prints a **contract ID**. Record it and add it to `scripts/.env` or to the relevant env variable if the backend or mobile app needs to call that contract.

To deploy all contracts at once using the monorepo helper script:

```bash
cd scripts
npm install
npx ts-node deploy.ts
```

---

## 8. Seeded / Test Data

### Database seed

The backend does not ship an automatic seed script yet. To populate basic data for local testing, run the backend with `USE_MOCK_TRANSACTIONS=true` (already set in the example `.env`). This flag makes the portfolio and transaction endpoints return synthetic Stellar data without requiring live on-chain calls.

### Testnet XLM

Use the [Stellar Friendbot](https://laboratory.stellar.org/#?network=test) to fund any testnet address with 10,000 XLM. This is free and instant.

### News data

The data processing service fetches news from external APIs (CryptoCompare, NewsAPI). For local development without API keys, the service falls back to a small set of static fixtures located in `apps/data-processing/data/`. Set `RUN_IMMEDIATELY=false` (default) so the scheduler does not attempt live fetches on startup.

---

## 9. Running Tests

Run all tests from the repository root:

```bash
pnpm turbo run test
```

Or per service:

```bash
# Backend (Jest)
cd apps/backend && npm run test

# Backend end-to-end
cd apps/backend && npm run test:e2e

# Web app (Vitest)
cd apps/webapp && npm run test

# Rust contracts
cd apps/onchain && cargo test --workspace

# Python data processing (pytest)
cd apps/data-processing
source venv/bin/activate
pytest
```

Lint checks:

```bash
pnpm turbo run lint                              # JS/TS
cd apps/onchain && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings
cd apps/data-processing && source venv/bin/activate && flake8 src/
```

---

## 10. Common Failures and Recovery

### `Error: connect ECONNREFUSED 127.0.0.1:5433`

The backend cannot reach PostgreSQL.

1. Check Docker is running: `docker compose ps`
2. If postgres is not healthy: `docker compose up -d postgres`
3. Confirm `DB_PORT=5433` in `apps/backend/.env` (not 5432).

---

### `Error: connect ECONNREFUSED 127.0.0.1:6379`

Redis is not running.

```bash
docker compose up -d redis
```

---

### `Error: Missing required env var DB_PASSWORD` (or JWT_SECRET / STELLAR_SERVER_SECRET)

The backend refuses to start if any required secret is absent.

1. Open `apps/backend/.env`.
2. Set `DB_PASSWORD`, `JWT_SECRET`, and `STELLAR_SERVER_SECRET` to non-empty values.
3. Restart the backend.

---

### `npm run migration:run` fails with relation already exists

The database has stale migrations from a previous run.

```bash
cd apps/backend
npm run migration:revert   # roll back the last migration
npm run migration:run      # re-apply
```

If the schema is badly out of sync, drop and recreate:

```bash
docker compose down -v       # removes volumes — destroys all local data
docker compose up -d postgres redis
cd apps/backend && npm run migration:run
```

---

### `cargo build` fails: `error[E0463]: can't find crate for std` with wasm target

The wasm target is not installed.

```bash
rustup target add wasm32-unknown-unknown
```

---

### `soroban: command not found`

Soroban CLI was not installed or is not on PATH.

```bash
cargo install --locked soroban-cli
# Add ~/.cargo/bin to PATH if not already present
export PATH="$HOME/.cargo/bin:$PATH"
```

---

### `pip install -r requirements.txt` fails with a build error on `psycopg2`

Install the binary wheel instead:

```bash
pip install psycopg2-binary
pip install -r requirements.txt
```

---

### `alembic upgrade head` fails with `psycopg2.OperationalError`

The data processing service uses a different `DB_PORT` than the backend.

1. Open `apps/data-processing/.env`.
2. Set `DATABASE_URL=postgresql://lumenpulse:lumenpulse@localhost:5433/lumenpulse` (port `5433`).
3. Also set `DB_PORT=5433`.

---

### Freighter wallet not detected in the web app

1. Confirm the Freighter extension is installed and unlocked.
2. The extension must be on the **Testnet** network (matches `STELLAR_NETWORK=testnet` in backend env).
3. If the browser blocks the extension on localhost, add `localhost` to Freighter's allowed sites in its settings.

---

### `CORS error` when the web app calls the backend

Check that `CORS_ORIGIN` in `apps/backend/.env` includes the web app origin:

```env
CORS_ORIGIN=http://localhost:3000,http://localhost:3001,http://localhost:8081
```

Restart the backend after changing this value.

---

### Data processing service returns `403 Forbidden`

The backend's `PYTHON_API_KEY` and the data processing service's `API_KEY` must match.

```env
# apps/backend/.env
PYTHON_API_KEY=local-dev-key

# apps/data-processing/.env
API_KEY=local-dev-key
```

---

## 11. Port Reference

| Service | Default port | Env variable controlling it |
|---|---|---|
| Web app (Next.js) | `3000` | — (Next.js default) |
| Backend API (NestJS) | `3001` | `PORT` in `apps/backend/.env` |
| Data processing (FastAPI) | `8000` | hardcoded in `start_api.py` |
| Mobile (Expo) | `8081` | Expo default |
| PostgreSQL (host) | `5433` | Docker compose `ports` mapping |
| Redis | `6379` | Docker compose `ports` mapping |

---

For area-specific details see:
- [Backend Contributing Guide](backend-contributing.md)
- [Contracts Guide](contracts-contributing.md)
- [Mobile Guide](mobile-contributing.md)
- [Smart Contract Interface Reference](SMART_CONTRACTS.md)
- [Stellar Migration Notes](STELLAR_MIGRATION_NOTES.md)
