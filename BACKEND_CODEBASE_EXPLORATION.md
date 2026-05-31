# Backend Codebase Exploration: Comprehensive Overview

## 1. Overall Structure of `src/` Directory

The backend follows a modular, feature-driven architecture with clear separation of concerns:

```
src/
├── analytics/              # Analytics and reporting features
├── app.controller.ts       # Root application controller
├── app.module.ts           # Root application module (defines global guards/interceptors)
├── app.service.ts          # Root application service
├── audit/                  # Audit logging infrastructure
│   ├── audit.controller.ts
│   ├── audit.service.ts
│   ├── entities/
│   ├── decorators/
│   └── interceptors/
├── auth/                   # Authentication & Authorization
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt-auth.guard.ts
│   ├── jwt.strategy.ts
│   ├── roles.guard.ts
│   ├── decorators/         # @Roles, @GetUser, @GetStellarPublicKey, @Public
│   ├── dto/
│   └── entities/
├── bootstrap/              # Bootstrap logic
├── cache/                  # Caching module
├── common/                 # Shared utilities and infrastructure
│   ├── guards/
│   ├── interceptors/
│   ├── middleware/
│   ├── rate-limit/
│   ├── decorators/
│   └── access-control.module.ts  # Shared access control interface
├── config/                 # Configuration endpoint
│   ├── config.controller.ts  # GET /config/stellar - serves contracts to clients
│   └── config.service.ts
├── crowdfund/              # Crowdfunding features
├── database/               # Database configuration & migrations
│   ├── data-source.ts      # TypeORM data source
│   ├── database.config.ts
│   └── migrations/
├── email/                  # Email service
├── exchange-rates/         # Exchange rate tracking
├── export/                 # Data export functionality
├── feature-flags/          # Feature flag system
├── filters/                # Exception filters
├── grants/                 # Grant management
├── health/                 # Health checks including contract health
│   └── contract-health.service.ts  # Validates contracts at startup
├── interfaces/             # Shared interfaces/types
├── lib/                    # Core libraries
│   └── config.ts          # Central config with all env vars
├── main.ts                 # Application entry point
├── metrics/                # Prometheus metrics
├── migrations/             # Data migrations
├── model-retraining/       # ML model retraining
├── moderation/             # Content moderation
├── news/                   # News/sentiment data
├── notification/           # Notifications module
├── outbox/                 # Outbox pattern implementation
├── portfolio/              # User portfolio management
├── price/                  # Price tracking
├── queue/                  # Message queue (Bull)
├── reconciliation/         # Data reconciliation
├── scheduler/              # Scheduled tasks (Cron)
├── search/                 # Full-text search
├── sentiment/              # Sentiment analysis
├── signals/                # Trading signals
├── snapshot/               # Data snapshots
├── soroban-events/         # Soroban contract event processing
│   ├── soroban-events.controller.ts
│   ├── soroban-events.service.ts
│   ├── soroban-events.processor.ts
│   └── entities/soroban-event.entity.ts
├── stellar/                # Stellar network integration
│   ├── stellar.service.ts
│   ├── stellar.controller.ts
│   ├── config/stellar.config.ts
│   ├── dto/
│   └── exceptions/
├── stellar-sync/           # Stellar data synchronization
├── telegram-bot/           # Telegram bot integration
├── test/                   # Test utilities
├── transaction/            # Transaction management
├── treasury/               # Treasury management
├── types/                  # TypeScript type definitions
├── upload/                 # File upload handling
├── users/                  # User management
│   ├── entities/
│   │   ├── user.entity.ts
│   │   └── stellar-account.entity.ts
│   └── users.service.ts
├── verification/           # Verification workflows
├── watchlist/              # User watchlists
└── webhook/                # Webhook handling
    ├── webhook.controller.ts
    ├── webhook.service.ts
    └── guards/WebhookVerificationGuard
```

**Key Architectural Patterns:**
- **NestJS Framework**: Full TypeORM ORM integration with dependency injection
- **Global Guards & Interceptors**: Registered in `app.module.ts`
- **Module-based Organization**: Each feature is a self-contained module
- **Decorator-driven**: Extensive use of NestJS decorators for metadata-driven patterns

---

## 2. Authentication & Authorization Implementation

### 2.1 Authentication Strategy: JWT with Stellar Public Key

**Location:** [src/auth/](apps/backend/src/auth/)

#### Authentication Flow:
1. **Challenge-Response (Stellar-based):**
   - User requests challenge: `GET /auth/challenge` → receives XDR transaction to sign
   - User signs with Stellar keypair
   - User submits signed challenge: `POST /auth/verify-challenge`
   - Server validates signature using Stellar SDK

2. **JWT Tokens:**
   - On successful auth, server issues JWT containing:
     - `sub`: User ID (UUID)
     - `stellarPublicKey`: User's Stellar public key
     - `type`: Token type
     - `email`: User email
     - `role`: User role (USER, REVIEWER, ADMIN)

#### Core Files:

| File | Purpose |
|------|---------|
| [jwt.strategy.ts](apps/backend/src/auth/jwt.strategy.ts) | Passport JWT strategy - extracts & validates JWT from bearer token |
| [jwt-auth.guard.ts](apps/backend/src/auth/jwt-auth.guard.ts) | Main authentication guard - checks JWT validity, respects `@Public()` |
| [roles.guard.ts](apps/backend/src/auth/roles.guard.ts) | RBAC guard - checks user role against `@Roles()` decorator |
| [auth.service.ts](apps/backend/src/auth/auth.service.ts) | Challenge generation, signature verification, JWT issuance |
| [decorators/auth.decorators.ts](apps/backend/src/auth/decorators/auth.decorators.ts) | Route protection decorators |

#### Key Decorators:

```typescript
// From auth.decorators.ts
@Roles(UserRole.ADMIN)           // Restrict to specific roles
@Public()                         // Skip JWT auth for public endpoints
@GetUser()                        // Inject authenticated user object
@GetStellarPublicKey()            // Inject user's Stellar public key
```

### 2.2 Authorization: Role-Based Access Control (RBAC)

**User Roles** ([user.entity.ts](apps/backend/src/users/entities/user.entity.ts)):
```typescript
enum UserRole {
  USER = 'user',           // Regular user
  REVIEWER = 'reviewer',   // Can review/approve certain actions
  ADMIN = 'admin',         // Full admin access
}
```

**Typical Guard Pattern** (from [grants.controller.ts](apps/backend/src/grants/grants.controller.ts)):
```typescript
@UseGuards(JwtAuthGuard, RolesGuard)  // Chain: JWT auth → role check
@Roles(UserRole.ADMIN)                // Only admins can call this
@Post('rounds')
createRound(@Body() dto: CreateRoundDto) { ... }
```

**Flow:**
1. `JwtAuthGuard` validates JWT and populates `request.user`
2. `RolesGuard` reads `@Roles()` metadata from handler
3. If route has no `@Roles()`, access is allowed (optional authorization)
4. If roles don't match, throws `ForbiddenException`

### 2.3 Shared Access Control Infrastructure

**Location:** [common/access-control.module.ts](apps/backend/src/common/access-control.module.ts) + [ACCESS_CONTROL_GUIDE.md](apps/backend/src/common/ACCESS_CONTROL_GUIDE.md)

Provides higher-level abstraction:
- `IAccessControlService` - Query access control information
- Decorators: `@RequirePermission`, `@RequireUserRead`, `@RequireWebhookVerification`
- Support for resource ownership checks, webhook verification, etc.

### 2.4 Other Guards

| Guard | File | Purpose |
|-------|------|---------|
| `RateLimitGuard` | `common/rate-limit/rate-limit.guard.ts` | Global throttling (registered in app.module) |
| `IpAllowlistGuard` | `metrics/` | IP whitelist for metrics endpoint |
| `WebhookVerificationGuard` | `webhook/` | HMAC signature verification for webhooks |

---

## 3. Contract ID Management: Testnet Contracts

### 3.1 How Contract IDs Are Stored & Managed

**Primary Storage Location:** Environment Variables (recommended for secrets/config)

All 6 contract IDs are managed via environment variables:

```
STELLAR_CONTRACT_LUMEN_TOKEN             # ERC-20 equivalent (XLM wrapper)
STELLAR_CONTRACT_CROWDFUND_VAULT         # Vault for crowdfunding
STELLAR_CONTRACT_PROJECT_REGISTRY        # Project registry
STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY    # Contributor registry
STELLAR_CONTRACT_MATCHING_POOL           # QF matching pool
STELLAR_CONTRACT_TREASURY                # Treasury management
```

**Configuration Chain:**

1. **Environment → [lib/config.ts](apps/backend/src/lib/config.ts)** (lines 1012-1019):
   ```typescript
   contracts: Object.freeze({
     lumenToken: parsedEnv.STELLAR_CONTRACT_LUMEN_TOKEN ?? null,
     crowdfundVault: parsedEnv.STELLAR_CONTRACT_CROWDFUND_VAULT ?? null,
     projectRegistry: parsedEnv.STELLAR_CONTRACT_PROJECT_REGISTRY ?? null,
     contributorRegistry: parsedEnv.STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY ?? null,
     matchingPool: parsedEnv.STELLAR_CONTRACT_MATCHING_POOL ?? null,
     treasury: parsedEnv.STELLAR_CONTRACT_TREASURY ?? null,
   })
   ```
   - Frozen for immutability
   - Defaults to `null` if env var not set (allows graceful degradation)

2. **Config Service** ([config/config.service.ts](apps/backend/src/config/config.service.ts)):
   ```typescript
   getStellarConfig(): StellarConfigResponseDto {
     return {
       network,
       horizonUrl: this.stellarCfg.horizonUrl,
       sorobanRpcUrl: this.stellarCfg.sorobanRpcUrl,
       networkPassphrase,
       contracts: {
         lumenToken: config.stellar.contracts.lumenToken ?? null,
         crowdfundVault: config.stellar.contracts.crowdfundVault ?? null,
         // ... all 6 contracts
       },
     };
   }
   ```

3. **Stellar Configuration** ([stellar/config/stellar.config.ts](apps/backend/src/stellar/config/stellar.config.ts)):
   - Registers stellar config with NestJS ConfigModule
   - Makes it injectable via `@Inject(stellarConfig.KEY)`

### 3.2 Testnet-Specific Contract Handling

**Network Detection** ([lib/config.ts](apps/backend/src/lib/config.ts)):
```typescript
STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet')
```

**Network Passphrase Mapping** ([config/config.service.ts](apps/backend/src/config/config.service.ts)):
```typescript
const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
}
```

**Default RPC URLs** ([config/config.service.ts](apps/backend/src/config/config.service.ts)):
```typescript
const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
}
```

**Contract Health Validation** ([health/contract-health.service.ts](apps/backend/src/health/contract-health.service.ts)):
- At startup, verifies all configured contracts are reachable
- Tests read methods on each contract to detect misconfiguration
- Reports: `reachable`, `misconfigured`, or `unreachable`
- Redacts contract IDs in responses for security (shows only first/last 6 chars)

---

## 4. Config Endpoint for Contract IDs

### 4.1 Endpoint Definition

**File:** [config/config.controller.ts](apps/backend/src/config/config.controller.ts)

```
GET /config/stellar
Content-Type: application/json
Authentication: None (public endpoint)
Cache: 5 minutes
```

**Response DTO** ([config/dto/stellar-config.dto.ts](apps/backend/src/config/dto/stellar-config.dto.ts)):
```typescript
{
  network: 'testnet' | 'mainnet',
  horizonUrl: string,           // e.g., https://horizon-testnet.stellar.org
  sorobanRpcUrl: string,        // e.g., https://soroban-testnet.stellar.org
  networkPassphrase: string,    // Protocol-specific passphrase for signing
  contracts: {
    lumenToken: string | null,
    crowdfundVault: string | null,
    projectRegistry: string | null,
    contributorRegistry: string | null,
    matchingPool: string | null,
    treasury: string | null,
  }
}
```

### 4.2 Design Rationale

- **No Authentication Required**: Frontend needs this at startup before login
- **Public-Safe Data Only**: Never includes secrets, keys, or DB credentials
- **Cached for 5 minutes**: Config rarely changes at runtime
- **Graceful Nulls**: If contract address not configured, returns `null` instead of erroring
- **Network-Aware**: Automatically adapts URLs/passphrases based on `STELLAR_NETWORK` env var

**Controller Implementation:**
```typescript
@Get('stellar')
@HttpCode(HttpStatus.OK)
@UseInterceptors(CacheInterceptor)
@CacheTTL(300_000)  // 5 minutes
@ApiOperation({
  summary: 'Get Stellar network configuration',
  description: 'No authentication required. Intended to be fetched by frontend on startup.',
})
getStellarConfig(): StellarConfigResponseDto {
  return this.configService.getStellarConfig();
}
```

---

## 5. Audit Logging & Activity Logging

### 5.1 Audit Logging Infrastructure

**Location:** [audit/](apps/backend/src/audit/)

**Database Schema** ([audit/entities/audit-log.entity.ts](apps/backend/src/audit/entities/audit-log.entity.ts)):

```typescript
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'userId', type: 'uuid', nullable: true })
  @Index()
  userId: string | null;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  action: string;  // e.g., "user.login", "user.password_reset"

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;  // Action-specific data

  @CreateDateColumn({ type: 'timestamp with time zone' })
  @Index()
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;
}
```

**Database Migration** ([database/migrations/1773000000000-CreateAuditLogs.ts](apps/backend/src/database/migrations/1773000000000-CreateAuditLogs.ts)):
- Creates `audit_logs` table with UUID primary key
- Indexes on: userId, action, createdAt for efficient querying
- Foreign key to users (nullable, deleted users don't cascade)

### 5.2 How Audit Logging Is Triggered

**Decorator-Based Marking** ([audit/decorators/audit-log.decorator.ts](apps/backend/src/audit/decorators/audit-log.decorator.ts)):

```typescript
export const AUDIT_LOG_ACTION_KEY = 'audit_log_action';
export const AuditLogAction = (action: string) =>
  SetMetadata(AUDIT_LOG_ACTION_KEY, action);
```

Usage on route handlers:
```typescript
@Post('login')
@AuditLogAction('user.login')
async login(@Body() dto: LoginDto) { ... }
```

### 5.3 Automatic Capture via Interceptor

**Global Interceptor** ([audit/interceptors/audit-log.interceptor.ts](apps/backend/src/audit/interceptors/audit-log.interceptor.ts)):

- **Registered Globally** in `app.module.ts` as `APP_INTERCEPTOR`
- **Triggers on routes marked with `@AuditLogAction(action)`**
- **Flow:**
  1. Intercepts request before route handler
  2. Reads `@AuditLogAction` metadata from handler
  3. If metadata exists, proceeds with logging
  4. Extracts user ID from:
     - `request.user.id` (authenticated users)
     - `request.user.sub` (JWT payload sub field)
     - `request.body.email` (resolves for login/password-reset)
     - Response object (if user data returned)
  5. Extracts IP from `X-Forwarded-For` header or `request.ip`
  6. Redacts sensitive fields: `password`, `newPassword`, `token`, `signedChallenge`
  7. Logs asynchronously (fire-and-forget) via `AuditService.log()`

**Sensitive Data Redaction:**
```typescript
const sensitiveKeys = [
  'password',
  'newPassword',
  'token',
  'signedChallenge',
];
for (const key of sensitiveKeys) {
  if (key in metadata) {
    metadata[key] = '[REDACTED]';
  }
}
```

### 5.4 Audit Log Retrieval

**Admin-Only Endpoint** ([audit/audit.controller.ts](apps/backend/src/audit/audit.controller.ts)):

```
GET /admin/audit-logs
Authentication: JWT (required)
Authorization: ADMIN role required
Query: limit=100, offset=0
```

**Implementation:**
```typescript
@ApiTags('admin-audit-logs')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditController {
  @Get()
  async getAuditLogs(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const [logs, count] = await this.auditService.findAll(limit, offset);
    return { logs, count };
  }
}
```

### 5.5 Soroban Event Logging (Event Stream)

**Location:** [soroban-events/](apps/backend/src/soroban-events/)

Separate from audit logs - tracks on-chain contract events:

**Entity** ([soroban-events/entities/soroban-event.entity.ts](apps/backend/src/soroban-events/entities/soroban-event.entity.ts)):
```typescript
@Entity('soroban_events')
export class SorobanEvent {
  id: string;
  txHash: string;
  eventIndex: number;
  contractId: string | null;     // Which contract emitted event
  eventType: string;             // Event name
  rawPayload: Record<string, any>;
  createdAt: Date;
}
```

**Processor** ([soroban-events/soroban-events.processor.ts](apps/backend/src/soroban-events/soroban-events.processor.ts)):
- Ingests Soroban contract events from blockchain
- Stores contractId, eventType, and event payload
- Separate from audit logs (different purpose: on-chain vs. off-chain actions)

---

## 6. Database Structure & ORM

### 6.1 Database: PostgreSQL with TypeORM

**ORM:** TypeORM (latest version) - NestJS native ORM

**Configuration** ([database/data-source.ts](apps/backend/src/database/data-source.ts)):

```typescript
export default new DataSource({
  type: 'postgres',
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password.reveal(),
  database: config.database.database,

  entities: ['dist/**/*.entity.js', 'src/**/*.entity.ts'],
  migrations: ['dist/database/migrations/*.js', 'src/database/migrations/*.ts'],
  migrationsTransactionMode: 'each',

  logging: true,
});
```

**Key Features:**
- **Auto-load Entities**: All `*.entity.ts` files automatically discovered
- **Migration System**: TypeORM migrations with per-migration transactions
- **Query Logging**: Enabled for debugging (configurable)

### 6.2 Core Entities

**User** ([users/entities/user.entity.ts](apps/backend/src/users/entities/user.entity.ts)):
- UUID primary key
- Email (unique, indexed)
- Stellar public key (unique, indexed)
- Role (indexed) - USER, REVIEWER, ADMIN
- 2FA support (secret, enabled flag)
- Preferences (JSONB) - notifications, currency
- Timestamps (created, updated)

**Stellar Account** ([users/entities/stellar-account.entity.ts](apps/backend/src/users/entities/stellar-account.entity.ts)):
- Link user's Stellar wallets
- Tracks off-chain data tied to on-chain accounts

**Audit Log** ([audit/entities/audit-log.entity.ts](apps/backend/src/audit/entities/audit-log.entity.ts)):
- See section 5.1 above

**Soroban Event** ([soroban-events/entities/soroban-event.entity.ts](apps/backend/src/soroban-events/entities/soroban-event.entity.ts)):
- Tracks on-chain contract events

**Password Reset Token** ([auth/entities/password-reset-token.entity.ts](apps/backend/src/auth/entities/password-reset-token.entity.ts)):
- Single-use reset tokens
- Expiry tracking (1 hour)

**Refresh Token** ([auth/entities/refresh-token.entity.ts](apps/backend/src/auth/entities/refresh-token.entity.ts)):
- Long-lived tokens (30 days)
- Allows session refresh without re-auth

### 6.3 Repository Pattern

**Injection Example** ([auth/auth.service.ts](apps/backend/src/auth/auth.service.ts)):

```typescript
constructor(
  @InjectRepository(User)
  private readonly userRepository: Repository<User>,
  @InjectRepository(PasswordResetToken)
  private readonly resetTokenRepository: Repository<PasswordResetToken>,
  @InjectRepository(RefreshToken)
  private readonly refreshTokenRepository: Repository<RefreshToken>,
  // ...
) {}
```

**QueryBuilder Usage** (TypeORM pattern):
```typescript
const [logs, count] = await this.auditLogRepo.findAndCount({
  order: { createdAt: 'DESC' },
  take: limit,
  skip: offset,
});
```

### 6.4 Key Indexes

For performance optimization:

| Table | Indexes |
|-------|---------|
| `users` | role, createdAt |
| `users` | email (unique) |
| `users` | stellarPublicKey (unique) |
| `audit_logs` | userId, action, createdAt |
| `soroban_events` | txHash, contractId (for event querying) |

### 6.5 Migration Management

**Location:** [database/migrations/](apps/backend/src/database/migrations/)

- Each migration is a TypeScript class implementing `MigrationInterface`
- Automatic discovery and execution
- Per-migration transactions for safety
- Rollback support via `.down()` method

---

## 7. Summary Table: Contract ID Flow

| Component | File | Role |
|-----------|------|------|
| **Env Input** | `.env` or platform secrets | Define contract addresses |
| **Config Parser** | [lib/config.ts](apps/backend/src/lib/config.ts) (lines 1012-1019) | Load & freeze config |
| **Service Provider** | [config/config.service.ts](apps/backend/src/config/config.service.ts) | Expose via DI |
| **Public Endpoint** | [config/config.controller.ts](apps/backend/src/config/config.controller.ts) | Serve to frontend |
| **Validator** | [health/contract-health.service.ts](apps/backend/src/health/contract-health.service.ts) | Verify on startup |
| **Event Processor** | [soroban-events/](apps/backend/src/soroban-events/) | Use in event ingestion |

---

## 8. Auth Guard Usage Patterns Summary

**Global Guards** (registered in [app.module.ts](apps/backend/src/app.module.ts)):
- `RateLimitGuard` - Throttles all requests

**Route-Level Guards** (typical pattern):
```typescript
// Public endpoint
@Get('projects')
@Public()  // Skip JWT
async listProjects() { ... }

// Authenticated user
@Post('watchlist')
@UseGuards(JwtAuthGuard)
async addToWatchlist(@GetUser() user: User) { ... }

// Role-restricted (admin only)
@Post('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
async createUser(@Body() dto: CreateUserDto) { ... }

// Webhook verification
@Post('webhooks/events')
@UseGuards(WebhookVerificationGuard)
async handleWebhook(@Body() event: WebhookEvent) { ... }
```

**Global Interceptors** (registered in [app.module.ts](apps/backend/src/app.module.ts)):
1. `AuditLogInterceptor` - Logs marked routes
2. `IdempotencyInterceptor` - Request deduplication
3. `DeprecationInterceptor` - API deprecation warnings

---

## 9. Key Files Reference

### Authentication & Authorization
- [auth/jwt-auth.guard.ts](apps/backend/src/auth/jwt-auth.guard.ts)
- [auth/jwt.strategy.ts](apps/backend/src/auth/jwt.strategy.ts)
- [auth/roles.guard.ts](apps/backend/src/auth/roles.guard.ts)
- [auth/auth.service.ts](apps/backend/src/auth/auth.service.ts)
- [auth/decorators/auth.decorators.ts](apps/backend/src/auth/decorators/auth.decorators.ts)

### Contract Management
- [lib/config.ts](apps/backend/src/lib/config.ts) - Lines 1012-1019: contract config
- [config/config.service.ts](apps/backend/src/config/config.service.ts)
- [config/config.controller.ts](apps/backend/src/config/config.controller.ts)
- [health/contract-health.service.ts](apps/backend/src/health/contract-health.service.ts)

### Audit & Logging
- [audit/audit.service.ts](apps/backend/src/audit/audit.service.ts)
- [audit/audit.controller.ts](apps/backend/src/audit/audit.controller.ts)
- [audit/entities/audit-log.entity.ts](apps/backend/src/audit/entities/audit-log.entity.ts)
- [audit/interceptors/audit-log.interceptor.ts](apps/backend/src/audit/interceptors/audit-log.interceptor.ts)
- [audit/decorators/audit-log.decorator.ts](apps/backend/src/audit/decorators/audit-log.decorator.ts)
- [soroban-events/](apps/backend/src/soroban-events/) - On-chain event logging

### Database
- [database/data-source.ts](apps/backend/src/database/data-source.ts)
- [database/database.config.ts](apps/backend/src/database/database.config.ts)
- [database/migrations/](apps/backend/src/database/migrations/)
- [users/entities/user.entity.ts](apps/backend/src/users/entities/user.entity.ts)

### Application Setup
- [app.module.ts](apps/backend/src/app.module.ts) - Global guards, interceptors, modules
- [main.ts](apps/backend/src/main.ts) - Bootstrap

---

## Key Insights for Testnet Contract Management

1. **Environment-Based**: Contract IDs come entirely from env vars - same codebase works for testnet/mainnet
2. **Network-Aware**: Config service automatically adjusts URLs, passphrases, and defaults based on `STELLAR_NETWORK`
3. **Health Checks**: On startup, contracts are validated - bad addresses caught immediately
4. **Frontend-Friendly**: Public `/config/stellar` endpoint provides everything frontend needs at startup
5. **Audit Trail**: All sensitive operations logged with user ID, IP, action, and redacted payloads
6. **Type-Safe**: Full TypeORM entity definitions with proper relationships and indexes
7. **No Hardcoding**: All addresses externalized - simple config change switches networks
