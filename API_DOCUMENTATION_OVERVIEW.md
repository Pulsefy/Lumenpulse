# Lumenpulse API Documentation - Comprehensive Overview

**Last Updated**: May 30, 2026  
**Project Location**: `/apps/backend/`  
**Swagger Docs URL**: `http://localhost:3000/api/docs`

---

## Executive Summary

Lumenpulse uses a **NestJS backend** with comprehensive Swagger/OpenAPI documentation already implemented. The API is well-structured with **27+ API tags**, URI-based versioning (`/v1/`, `/v2/`), and extensive use of `@nestjs/swagger` decorators throughout all controllers and DTOs.

### Key Status
- ✅ **Swagger Framework**: Fully configured in `main.ts`
- ✅ **Bearer JWT Auth**: Configured with `@ApiBearerAuth('JWT-auth')`
- ✅ **API Tags**: 27 documented endpoint categories
- ✅ **DTOs**: Comprehensive `@ApiProperty` decorators
- ✅ **Controller Documentation**: `@ApiOperation`, `@ApiResponse`, `@ApiParam` decorators
- ⚠️ **Testnet-Specific Docs**: Basic but could be enhanced
- ⚠️ **Contract Status Tracking**: Limited detailed documentation

---

## 1. Backend Framework & Setup

### Technology Stack
```json
{
  "framework": "NestJS 11.0.1",
  "swagger": "@nestjs/swagger 11.2.6",
  "database": "PostgreSQL with TypeORM",
  "authentication": "JWT (passport-jwt)",
  "validation": "class-validator, class-transformer",
  "caching": "cache-manager with Redis",
  "messageQueue": "BullMQ"
}
```

### Main Configuration File
**Location**: `src/main.ts`

```typescript
// Swagger setup:
const swaggerConfig = new DocumentBuilder()
  .setTitle('LumenPulse API')
  .setDescription('Comprehensive API documentation for LumenPulse - A decentralized crypto news aggregator...')
  .setVersion('1.0')
  .addBearerAuth({
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Enter JWT token',
  }, 'JWT-auth')
  .addTag('auth', 'Authentication and authorization endpoints')
  .addTag('users', 'User profile and account management')
  .addTag('news', 'Crypto news aggregation and sentiment analysis')
  .addTag('portfolio', 'Portfolio tracking and performance metrics')
  .addTag('stellar', 'Stellar blockchain integration')
  .addTag('config', 'Client-safe runtime configuration')
  .addTag('search', 'Search and discovery endpoints')
  .addServer('http://localhost:3000', 'Development')
  .addServer('https://api.lumenpulse.io', 'Production')
  .build();

SwaggerModule.setup('api/docs', app, document);
```

---

## 2. Current Swagger/OpenAPI Configuration

### Global Settings
- **API Versioning**: URI-based (`/v1/`, `/v2/`)
- **Authentication**: Bearer JWT
- **Base URL**: `/api/` prefix
- **Documentation Endpoint**: `/api/docs`
- **Environment Servers**: Development (localhost:3000) + Production

### API Tags (27 Total)

| Tag | Purpose | Location | Status |
|-----|---------|----------|--------|
| `auth` | Authentication & authorization | `src/auth/auth.controller.ts` | ✅ Complete |
| `users` | User profile management | `src/users/users.controller.ts` | ✅ Complete |
| `stellar` | Stellar blockchain ops | `src/stellar/stellar.controller.ts` | ✅ Complete |
| `config` | Runtime configuration | `src/config/config.controller.ts` | ✅ Complete |
| `transactions` | Transaction history | `src/transaction/transaction.controller.ts` | ⚠️ Basic |
| `soroban-events` | Contract events | `src/soroban-events/soroban-events.controller.ts` | ⚠️ Minimal |
| `crowdfund` | Crowdfunding projects | `src/crowdfund/crowdfund.controller.ts` | ✅ Complete |
| `portfolio` | Portfolio tracking | `src/portfolio/portfolio.controller.ts` | ✅ Complete |
| `news` | News aggregation | `src/news/news.controller.ts` | ✅ Complete |
| `search` | Search endpoints | `src/search/search.controller.ts` | ✅ Complete |
| `watchlist` | User watchlists | `src/watchlist/watchlist.controller.ts` | ✅ Complete |
| `notifications` | Notification prefs | `src/notification/notification-preference.controller.ts` | ✅ Complete |
| `verification` | Email/2FA verification | `src/verification/verification.controller.ts` | ✅ Complete |
| `webhooks` | Webhook mgmt | `src/webhook/webhook.controller.ts` | ✅ Complete |
| `signals` | Trading signals | `src/signals/signals.controller.ts` | ✅ Complete |
| `treasury` | Treasury ops | `src/treasury/treasury.controller.ts` | ⚠️ Minimal |
| `metrics` | System metrics | `src/metrics/metrics.controller.ts` | ✅ Complete |
| `health` | Health checks | `src/health/health.controller.ts` | ✅ Complete |
| `admin-audit-logs` | Audit logging | `src/audit/audit.controller.ts` | ✅ Complete |
| `admin-models` | ML model management | `src/model-retraining/model-retraining.controller.ts` | ✅ Complete |
| `grants` | Grant programs | `src/grants/grants.controller.ts` | ✅ Complete |
| `crowdfund` | Crowdfunding | `src/crowdfund/crowdfund.controller.ts` | ✅ Complete |
| `exports` | Data export | `src/export/export.controller.ts` | ✅ Complete |
| `reconciliation` | Data reconciliation | `src/reconciliation/reconciliation.controller.ts` | ✅ Complete |
| `feature-flags` | Feature toggles | `src/feature-flags/feature-flags.controller.ts` | ✅ Complete |
| `telegram-bot` | Telegram integration | `src/telegram-bot/telegram-bot.controller.ts` | ✅ Complete |
| `test` | Test utilities | `src/test/test.controller.ts` | ✅ Complete |

---

## 3. Testnet Configuration Endpoints

### Primary Endpoint: GET `/v1/config/stellar`

**Controller**: [config.controller.ts](src/config/config.controller.ts#L1)  
**Service**: [config.service.ts](src/config/config.service.ts)  
**DTO**: [stellar-config.dto.ts](src/config/dto/stellar-config.dto.ts)

**Current Implementation**:
```typescript
@Get('stellar')
@HttpCode(HttpStatus.OK)
@UseInterceptors(CacheInterceptor)
@CacheTTL(300_000) // 5 minutes
@ApiOperation({
  summary: 'Get Stellar network configuration',
  description: 'Returns client-safe Stellar network info and deployed contract addresses...'
})
@ApiResponse({
  status: 200,
  description: 'Stellar configuration retrieved successfully',
  type: StellarConfigResponseDto,
})
getStellarConfig(): StellarConfigResponseDto
```

**Response DTO** (`StellarConfigResponseDto`):
```typescript
export class StellarConfigResponseDto {
  @ApiProperty({
    description: 'Stellar network name',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: 'testnet' | 'mainnet';

  @ApiProperty({
    description: 'Stellar Horizon API URL',
    example: 'https://horizon-testnet.stellar.org',
  })
  horizonUrl: string;

  @ApiProperty({
    description: 'Stellar Soroban RPC URL',
    example: 'https://soroban-testnet.stellar.org',
    nullable: true,
  })
  sorobanRpcUrl: string | null;

  @ApiProperty({
    description: 'Network passphrase for transaction signing',
    example: 'Test SDF Network ; September 2015',
  })
  networkPassphrase: string;

  @ApiProperty({
    description: 'Deployed Soroban contract addresses',
    type: StellarContractsDto,
  })
  contracts: StellarContractsDto;
}

// Contract Addresses
export class StellarContractsDto {
  @ApiProperty({ description: 'Lumen token contract address', nullable: true })
  lumenToken: string | null;

  @ApiProperty({ description: 'Crowdfund vault contract address', nullable: true })
  crowdfundVault: string | null;

  @ApiProperty({ description: 'Project registry contract address', nullable: true })
  projectRegistry: string | null;

  @ApiProperty({ description: 'Contributor registry contract address', nullable: true })
  contributorRegistry: string | null;

  @ApiProperty({ description: 'Matching pool contract address', nullable: true })
  matchingPool: string | null;

  @ApiProperty({ description: 'Treasury contract address', nullable: true })
  treasury: string | null;
}
```

---

## 4. Transaction Status Endpoints

### Transaction History Endpoints

#### 1. GET `/v1/transactions/history` (Authenticated)
**Controller**: [transaction.controller.ts](src/transaction/transaction.controller.ts#L43)

```typescript
@Get('history')
@ApiOperation({ summary: 'Get transaction history for current user' })
@ApiResponse({
  status: 200,
  description: 'Returns transaction history',
  type: TransactionHistoryResponseDto,
})
async getTransactionHistory(
  @Req() req: RequestWithUser,
  @Query('limit') limit?: number,
  @Query('cursor') cursor?: string,
): Promise<TransactionHistoryResponseDto>
```

**Query Parameters**:
- `limit` (optional): Number of transactions (default: 50)
- `cursor` (optional): Pagination cursor from previous response

---

#### 2. GET `/v1/stellar/accounts/:publicKey/transactions`
**Controller**: [stellar.controller.ts](src/stellar/stellar.controller.ts#L60)

```typescript
@Get('accounts/:publicKey/transactions')
@HttpCode(HttpStatus.OK)
@ApiOperation({
  summary: 'Get account transactions',
  description: 'Fetches recent transaction history for a given Stellar public key',
})
@ApiParam({
  name: 'publicKey',
  description: 'Stellar account public key',
  example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
})
@ApiResponse({ status: 200, description: 'Account transactions retrieved successfully' })
```

---

#### 3. GET `/v1/stellar/transactions` (Authenticated, Cached)
**Controller**: [stellar.controller.ts](src/stellar/stellar.controller.ts#L118)

```typescript
@Get('transactions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@UseInterceptors(CacheInterceptor)
@CacheTTL(60_000)
@ApiOperation({
  summary: 'Get transaction history for a Stellar account',
  description: 'Fetches and formats paginated transaction history with human-readable descriptions',
})
@ApiQuery({
  name: 'publicKey',
  required: true,
  description: 'Stellar account public key',
})
@ApiQuery({
  name: 'limit',
  required: false,
  description: 'Number of transactions (default: 50, max: 200)',
  example: 50,
})
@ApiQuery({
  name: 'cursor',
  required: false,
  description: 'Pagination cursor from previous response',
})
```

**Query Parameters**:
- `publicKey` (required): Stellar account public key
- `limit` (optional): Max 200, default 50
- `cursor` (optional): Pagination cursor

---

### Transaction DTO Models

**TransactionHistoryResponseDto** ([transaction.dto.ts](src/transaction/dto/transaction.dto.ts)):
```typescript
export enum TransactionType {
  PAYMENT = 'payment',
  SWAP = 'swap',
  TRUSTLINE = 'trustline',
  CREATE_ACCOUNT = 'create_account',
  ACCOUNT_MERGE = 'account_merge',
  INFLATION = 'inflation',
}

export enum TransactionStatus {
  SUCCESS = 'success',
  PENDING = 'pending',
  FAILED = 'failed',
}

export class TransactionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  assetCode: string;

  @ApiProperty()
  assetIssuer: string | null;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  date: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty()
  transactionHash: string;

  @ApiProperty({ required: false })
  memo?: string;

  @ApiProperty({ required: false })
  fee?: string;

  @ApiProperty({ description: 'Human-readable description' })
  description: string;
}

export class TransactionHistoryResponseDto {
  @ApiProperty({ type: [TransactionDto] })
  transactions: TransactionDto[];

  @ApiProperty()
  total: number;

  @ApiProperty({ required: false })
  nextPage?: string;
}
```

---

## 5. Contract-Related Operations & Soroban Events

### Soroban Events Endpoint

**Location**: [soroban-events.controller.ts](src/soroban-events/soroban-events.controller.ts)

#### POST `/v1/soroban-events/ingest` (Requires Secret Header)

```typescript
@Post('ingest')
@HttpCode(HttpStatus.ACCEPTED)
@ApiTags('soroban-events')
@ApiOperation({ summary: 'Ingest a Soroban event from the indexer/cron' })
@ApiResponse({ status: 202, description: 'Event accepted for processing' })
@ApiResponse({ status: 401, description: 'Missing or invalid ingest secret' })
async ingest(
  @Headers('x-ingest-secret') secret: string,
  @Body() dto: IngestSorobanEventDto,
)
```

**Required Header**:
- `x-ingest-secret`: Secret token for authentication

**Request DTO** (`IngestSorobanEventDto`):
```typescript
export class IngestSorobanEventDto {
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @IsInt()
  @Min(0)
  eventIndex: number;

  @IsString()
  @IsOptional()
  contractId?: string;  // ← Contract address

  @IsString()
  @IsOptional()
  eventType?: string;   // ← Event type (e.g., 'transfer', 'mint')

  @IsObject()
  rawPayload: Record<string, unknown>;
}
```

### Soroban Event Entity

**Location**: [soroban-event.entity.ts](src/soroban-events/entities/soroban-event.entity.ts)

```typescript
export enum SorobanEventStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Entity('soroban_events')
@Index(['txHash', 'eventIndex'], { unique: true })
@Index(['status'])
export class SorobanEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 128 })
  txHash: string;

  @Column({ type: 'integer' })
  eventIndex: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  contractId: string | null;  // ← Soroban contract address

  @Column({ type: 'varchar', length: 128, nullable: true })
  eventType: string | null;   // ← Event type

  @Column({ type: 'jsonb' })
  rawPayload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: SorobanEventStatus,
    default: SorobanEventStatus.PENDING,
  })
  status: SorobanEventStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
```

---

### Crowdfund Contract Operations

**Location**: [crowdfund.controller.ts](src/crowdfund/crowdfund.controller.ts)

Endpoints for managing Soroban contract-based crowdfunding:

#### GET `/v1/crowdfund/projects`
```typescript
@Get('projects')
@ApiOperation({
  summary: 'List all crowdfund projects',
  description: 'Retrieves a list of all active and inactive projects.',
})
@ApiResponse({
  status: 200,
  description: 'List of projects retrieved successfully',
  type: [CrowdfundProjectDto],
})
```

#### GET `/v1/crowdfund/projects/:id`
```typescript
@Get('projects/:id')
@ApiOperation({
  summary: 'Get project details',
  description: 'Retrieves detailed information of a single project by its ID.',
})
@ApiResponse({ status: 200, type: CrowdfundProjectDto })
@ApiResponse({ status: 404, description: 'Project not found' })
```

#### POST `/v1/crowdfund/projects` (Authenticated)
```typescript
@Post('projects')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
@ApiOperation({
  summary: 'Create a new project',
  description: 'Creates a project listing. Requires authentication.',
})
@ApiResponse({ status: 201, type: CrowdfundProjectDto })
```

#### POST `/v1/crowdfund/contribute`
```typescript
@Post('contribute')
@ApiOperation({
  summary: 'Contribute to a project',
  description: 'Submit a contribution transaction to support a project.',
})
@ApiResponse({
  status: 200,
  description: 'Contribution processed successfully',
  type: ContributionResponseDto,
})
```

#### GET `/v1/crowdfund/projects/:id/balance`
```typescript
@Get('projects/:id/balance')
@ApiOperation({
  summary: 'Get project balance info',
  description: 'Retrieve details about deposits, withdrawals, and balance.',
})
@ApiResponse({
  status: 200,
  description: 'Balance info retrieved successfully',
  schema: {
    properties: {
      totalDeposited: { type: 'string', example: '15000' },
      totalWithdrawn: { type: 'string', example: '0' },
      balance: { type: 'string', example: '15000' },
    },
  },
})
```

**Crowdfund DTO with Contract Address** ([crowdfund.dto.ts](src/crowdfund/dto/crowdfund.dto.ts)):
```typescript
export class CrowdfundProjectDto {
  // ... other fields
  
  @ApiProperty({
    description: 'Stellar smart contract address of the crowdfund vault',
    example: 'CABL2E2NKLCQIRSF6BXVB4NLSDBNJ2QBFVGXNLGBMZFDWRQKQ7MWDKD',
    nullable: true,
  })
  contractAddress?: string;
}
```

---

## 6. Related Stellar Endpoints

### Account Balances

#### GET `/v1/stellar/accounts/:publicKey/balances`
```typescript
@Get('accounts/:publicKey/balances')
@UseInterceptors(CacheInterceptor)
@CacheTTL(30_000)
@ApiOperation({
  summary: 'Get account balances',
  description: 'Fetches real-time token balances for a given Stellar public key',
})
@ApiParam({
  name: 'publicKey',
  description: 'Stellar account public key',
  example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
})
@ApiResponse({
  status: 200,
  type: AccountBalancesDto,
})
```

**Response DTO** (`AccountBalancesDto`):
```typescript
export class AssetBalanceDto {
  @ApiProperty({
    description: 'Asset type (native, credit_alphanum4, credit_alphanum12)',
    example: 'native',
  })
  assetType: string;

  @ApiProperty({ required: false })
  assetCode?: string;

  @ApiProperty({ required: false })
  assetIssuer?: string;

  @ApiProperty({ example: '1000.0000000' })
  balance: string;

  @ApiProperty({ required: false })
  limit?: string;
}

export class AccountBalancesDto {
  @ApiProperty()
  publicKey: string;

  @ApiProperty({ type: [AssetBalanceDto] })
  balances: AssetBalanceDto[];

  @ApiProperty({ required: false })
  sequenceNumber?: string;
}
```

### Asset Discovery

#### GET `/v1/stellar/assets`
```typescript
@Get('assets')
@UseInterceptors(CacheInterceptor)
@CacheTTL(600_000)
@ApiOperation({
  summary: 'Discover Stellar assets',
  description: 'Search for Stellar assets by code, issuer, or partial match',
})
@ApiResponse({
  status: 200,
  type: AssetDiscoveryResponseDto,
})
```

**Query Parameters** (`AssetDiscoveryQueryDto`):
```typescript
export class AssetDiscoveryQueryDto {
  @ApiProperty({
    description: 'Asset code to search for (exact match)',
    example: 'USDC',
    required: false,
  })
  @IsOptional()
  @IsString()
  assetCode?: string;

  @ApiProperty({
    description: 'Asset issuer to search for',
    required: false,
  })
  @IsOptional()
  @IsString()
  issuer?: string;

  @ApiProperty({
    description: 'General search query (partial match)',
    example: 'USD',
    required: false,
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({ required: false })
  cursor?: string;
}
```

### Health Check

#### GET `/v1/stellar/health`
```typescript
@Get('health')
@ApiOperation({
  summary: 'Check Horizon API health',
  description: 'Verifies if the Stellar Horizon API is available',
})
@ApiResponse({
  status: 200,
  description: 'Horizon API is healthy',
  schema: {
    properties: {
      status: { type: 'string', example: 'healthy' },
      horizonUrl: { type: 'string' },
      network: { type: 'string' },
    },
  },
})
@ApiResponse({ status: 503, description: 'Horizon API is unavailable' })
```

---

## 7. DTO/Model Definitions Summary

### Core DTOs with Swagger Decorators

| DTO | Location | Purpose | Status |
|-----|----------|---------|--------|
| `StellarConfigResponseDto` | `config/dto/stellar-config.dto.ts` | Network & contract config | ✅ Complete |
| `StellarContractsDto` | `config/dto/stellar-config.dto.ts` | Contract addresses | ✅ Complete |
| `TransactionHistoryResponseDto` | `transaction/dto/transaction.dto.ts` | TX history response | ✅ Complete |
| `TransactionDto` | `transaction/dto/transaction.dto.ts` | Individual transaction | ✅ Complete |
| `AccountBalancesDto` | `stellar/dto/balance.dto.ts` | Account balances | ✅ Complete |
| `AssetBalanceDto` | `stellar/dto/balance.dto.ts` | Individual asset balance | ✅ Complete |
| `AssetDiscoveryQueryDto` | `stellar/dto/asset-discovery.dto.ts` | Asset search query | ✅ Complete |
| `AssetDiscoveryResponseDto` | `stellar/dto/asset-discovery.dto.ts` | Asset search response | ✅ Complete |
| `IngestSorobanEventDto` | `soroban-events/dto/ingest-soroban-event.dto.ts` | Event ingestion | ⚠️ Minimal |
| `SorobanEvent` | `soroban-events/entities/soroban-event.entity.ts` | Event entity model | ✅ Complete |
| `CrowdfundProjectDto` | `crowdfund/dto/crowdfund.dto.ts` | Crowdfund project | ✅ Complete |
| `ContributionResponseDto` | `crowdfund/dto/crowdfund.dto.ts` | Contribution response | ✅ Complete |

### Swagger Decorator Usage Pattern

All DTOs follow this pattern:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';

export class ExampleDto {
  @ApiProperty({
    description: 'Field description',
    example: 'example value',
    required: true,
  })
  @IsString()
  fieldName: string;

  @ApiPropertyOptional({
    description: 'Optional field',
    nullable: true,
  })
  @IsOptional()
  optionalField?: string | null;
}
```

---

## 8. Existing Swagger Decorators

### Controller-Level Decorators (Standard Pattern)

```typescript
@ApiTags('endpoint-category')
@Controller({ path: 'endpoint-path', version: '1' })
export class EndpointController {
  // ...
}
```

### Endpoint-Level Decorators (Standard Pattern)

```typescript
@Get('/path')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)          // Optional: if authenticated
@ApiBearerAuth('JWT-auth')         // Optional: if authenticated
@UseInterceptors(CacheInterceptor) // Optional: if cached
@CacheTTL(300_000)                 // Optional: cache duration
@ApiOperation({
  summary: 'Endpoint summary',
  description: 'Detailed endpoint description',
})
@ApiParam({
  name: 'paramName',
  description: 'Parameter description',
  example: 'example-value',
})
@ApiQuery({
  name: 'queryName',
  description: 'Query parameter description',
  required: false,
})
@ApiResponse({
  status: 200,
  description: 'Success response',
  type: ResponseDto,
})
@ApiResponse({ status: 400, description: 'Bad request' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 404, description: 'Not found' })
@ApiResponse({ status: 500, description: 'Internal server error' })
async methodName(
  @Param('paramName') paramName: string,
  @Query('queryName') queryName?: string,
  @Body() dto: RequestDto,
): Promise<ResponseDto> {
  // Implementation
}
```

---

## 9. API Versioning Strategy

**Location**: [document/API_VERSIONING_STRATEGY.md](apps/backend/document/API_VERSIONING_STRATEGY.md)

### URI-Based Versioning
- Enabled via `app.enableVersioning({ type: VersioningType.URI })`
- Format: `/v1/path`, `/v2/path`
- Controller-level versioning: `@Controller({ path: 'resource', version: '1' })`
- Route-level versioning: `@Version('2') @Get()`

### Three-Phase Deprecation Lifecycle
1. **Active Phase**: New version available, old version functional
2. **Deprecated Phase**: Warning headers added to old version
3. **Sunset Phase**: Old version removed completely

---

## 10. Documentation Testing

**Test Script**: [test-swagger-docs.sh](test-swagger-docs.sh)

The script validates:
- ✅ DocumentBuilder configuration in `main.ts`
- ✅ Bearer auth configuration
- ✅ API tags configuration
- ✅ Controller-level `@ApiTags` decorators
- ✅ DTO-level `@ApiProperty` decorators
- ✅ Documentation file presence

**Run Test**:
```bash
bash test-swagger-docs.sh
```

---

## 11. Gaps & Recommendations for Testnet Swagger Improvements

### Current Gaps

| Item | Status | Priority |
|------|--------|----------|
| Testnet-specific environment variables in config | ⚠️ | High |
| Transaction status query endpoint with filters | ❌ | High |
| Contract status tracking/querying | ⚠️ | High |
| Event payload schema documentation | ⚠️ | Medium |
| Soroban contract state queries | ❌ | Medium |
| Error code reference documentation | ⚠️ | Medium |
| Rate limiting documentation | ❌ | Low |

### Recommended Enhancements

1. **New Endpoint**: `GET /v1/stellar/contracts/:contractId/status`
   - Query Soroban contract state on testnet
   - Returns contract balance, nonce, code hash
   - Cache: 10 seconds

2. **Enhanced Endpoint**: `GET /v1/stellar/transactions` with filters
   - Add `type` filter: `?type=payment,swap`
   - Add `status` filter: `?status=success,pending`
   - Add `fromDate` / `toDate`: `?fromDate=2024-01-01&toDate=2024-02-01`
   - Add `assetCode` filter: `?assetCode=USDC`

3. **New DTO**: `TransactionStatusQueryDto` with comprehensive filters
   ```typescript
   export class TransactionStatusQueryDto {
     @ApiProperty({ required: false, enum: TransactionType })
     type?: TransactionType;

     @ApiProperty({ required: false, enum: TransactionStatus })
     status?: TransactionStatus;

     @ApiProperty({ required: false })
     fromDate?: string;

     @ApiProperty({ required: false })
     toDate?: string;

     @ApiProperty({ required: false })
     assetCode?: string;
   }
   ```

4. **Enhanced Soroban Event Documentation**
   - Detailed `eventType` enumeration
   - Example payloads for common events (transfer, mint, burn)
   - Status tracking workflow diagram

5. **Contract Address Registry Endpoint**
   - `GET /v1/stellar/contracts` - List all known contracts
   - Include metadata: name, purpose, deployment date, network

6. **Testnet-Specific Documentation**
   - Add to `main.ts` configuration
   - Separate swagger documentation for testnet vs mainnet (if needed)
   - Faucet information / testnet account funding guide

---

## 12. File Structure Quick Reference

```
apps/backend/
├── src/
│   ├── main.ts                          ← Swagger configuration
│   ├── config/
│   │   ├── config.controller.ts        ← Testnet config endpoint
│   │   ├── config.service.ts
│   │   └── dto/
│   │       └── stellar-config.dto.ts   ← Config DTOs
│   ├── transaction/
│   │   ├── transaction.controller.ts   ← TX history endpoints
│   │   └── dto/
│   │       └── transaction.dto.ts      ← TX DTOs
│   ├── stellar/
│   │   ├── stellar.controller.ts       ← Stellar operations
│   │   ├── stellar.service.ts
│   │   └── dto/
│   │       ├── balance.dto.ts
│   │       └── asset-discovery.dto.ts
│   ├── soroban-events/
│   │   ├── soroban-events.controller.ts ← Event ingestion
│   │   ├── soroban-events.service.ts
│   │   ├── entities/
│   │   │   └── soroban-event.entity.ts  ← Event model
│   │   └── dto/
│   │       └── ingest-soroban-event.dto.ts
│   ├── crowdfund/
│   │   ├── crowdfund.controller.ts     ← Contract operations
│   │   ├── crowdfund.service.ts
│   │   └── dto/
│   │       └── crowdfund.dto.ts
│   └── [27 other modules with @ApiTags]
├── document/
│   └── API_VERSIONING_STRATEGY.md
├── package.json
├── nest-cli.json
└── tsconfig.json

[Root]
├── test-swagger-docs.sh                 ← Swagger documentation test
└── API_DOCUMENTATION_OVERVIEW.md        ← This file
```

---

## 13. Authentication & Authorization

### JWT Bearer Token Configuration

All protected endpoints use the same JWT bearer auth:

```typescript
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')  // Matches config in main.ts
```

### Headers Required
```
Authorization: Bearer <JWT_TOKEN>
```

### Protected Endpoint Examples
- `POST /v1/crowdfund/projects` - Create project
- `POST /v1/crowdfund/contribute` - Contribute
- `GET /v1/crowdfund/projects/:id/my-contributions` - Get my contributions
- `GET /v1/stellar/transactions` - Get transaction history
- All endpoints in user-related, notification, watchlist modules

### Public Endpoints (No Auth Required)
- `GET /v1/config/stellar` - Network configuration
- `GET /v1/stellar/accounts/:publicKey/balances` - Account balances
- `GET /v1/stellar/accounts/:publicKey/transactions` - Account transactions
- `GET /v1/stellar/assets` - Asset discovery
- `GET /v1/stellar/health` - Horizon health check
- News, portfolio, and other read-only endpoints

---

## 14. Caching Strategy

### Endpoints with Caching

| Endpoint | Cache Duration | Reason |
|----------|-----------------|--------|
| `GET /v1/config/stellar` | 5 minutes | Config rarely changes |
| `GET /v1/stellar/accounts/:publicKey/balances` | 30 seconds | Real-time but expensive query |
| `GET /v1/stellar/transactions` | 60 seconds | Recent txs, moderate caching |
| `GET /v1/stellar/assets` | 10 minutes | Asset list changes slowly |

### Cache Implementation
```typescript
@UseInterceptors(CacheInterceptor)
@CacheTTL(300_000) // milliseconds
```

---

## 15. Error Handling & Response Codes

### Standard Response Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | OK | Successful GET/POST |
| 201 | Created | Successful resource creation |
| 202 | Accepted | Async operation (e.g., event ingestion) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid input, missing fields |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Item already exists (e.g., in watchlist) |
| 500 | Server Error | Internal server error |
| 503 | Service Unavailable | Horizon API down |

### Exception Classes

Located in `src/stellar/exceptions/`:
- `AccountNotFoundException` (404)
- `InvalidPublicKeyException` (400)
- `HorizonUnavailableException` (503)

---

## Summary: Current API Documentation State

### Strengths ✅
1. **Comprehensive Swagger setup** - All major endpoints documented
2. **Consistent decorators** - `@ApiTags`, `@ApiOperation`, `@ApiResponse` used throughout
3. **Type-safe DTOs** - All request/response models have Swagger decorators
4. **Authentication documented** - Bearer JWT auth clearly marked
5. **Caching strategy clear** - Cache interceptors and TTL documented
6. **Error responses documented** - Status codes and meanings defined
7. **API versioning strategy** - URI-based versioning with deprecation plan

### Areas Needing Enhancement ⚠️
1. **Testnet-specific documentation** - Could add testnet faucet, account info
2. **Transaction filtering** - No complex query filtering documented
3. **Contract status queries** - Limited contract state querying
4. **Event payload schemas** - Soroban event examples incomplete
5. **Rate limiting** - Not documented in API
6. **Webhook signature validation** - Webhook security details minimal

---

## How to Access Swagger UI

**Development**:
```
http://localhost:3000/api/docs
```

**Production**:
```
https://api.lumenpulse.io/api/docs
```

**Swagger JSON**:
```
http://localhost:3000/api/docs-json
```

---

## Key Takeaways

Lumenpulse has a **solid foundation** for API documentation with NestJS + Swagger. The framework is properly configured, controllers are consistently documented, and DTOs follow best practices. The main opportunities for improvement relate to **testnet-specific enhancements** and **additional query filtering** for transaction status tracking, which align with the goals for Swagger documentation improvements.
