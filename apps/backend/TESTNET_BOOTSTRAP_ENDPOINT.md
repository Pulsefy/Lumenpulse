# Testnet Account Bootstrap Endpoint

## Overview

This endpoint provides a developer-only convenience for bootstrapping fresh testnet Stellar accounts by triggering Friendbot, Stellar's testnet-only account funding faucet.

**CRITICAL SECURITY PROPERTY**: This endpoint is completely inert on mainnet or non-testnet deployments and can never be abused as a relay to fund arbitrary accounts. The implementation uses multiple defense-in-depth safeguards.

## Endpoint Details

### Route
```
POST /dev/testnet-bootstrap/fund
```

### Authentication
- **Required**: Yes
- **Mechanism**: JWT Bearer token
- **Role**: `ADMIN` or `DEVELOPER` (see `UserRole` enum)
- **Guard**: `JwtAuthGuard` + `@Roles()` decorator

### Request

```json
{
  "publicKey": "GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I"
}
```

**Parameters:**
- `publicKey` (required, string): A Stellar testnet public key (Ed25519 format, starts with `G`)
  - Validation: Must pass `@IsStellarAddress()` decorator (reuses existing validator)
  - Pattern: Exactly 56 characters, begins with `G`, base32-encoded

### Response (Success - 200 OK)

```json
{
  "success": true,
  "message": "Account successfully funded via Friendbot",
  "publicKey": "GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I",
  "transactionHash": "baaffabaffabaffabaffabaffabaffabaffabaffabaffabaffabaffaba0",
  "fundingAmount": "100.0000000"
}
```

### Error Responses

#### 400 Bad Request — Invalid Public Key
```json
{
  "code": "STEL_004",
  "message": "Invalid Stellar public key: INVALID_KEY. Must be a valid Ed25519 public key (starting with G).",
  "requestId": "req-uuid"
}
```
- **Cause**: Malformed public key in request
- **Action**: Validate the public key format before retrying

#### 401 Unauthorized — Missing/Invalid Auth
```json
{
  "code": "AUTH_001",
  "message": "Unauthorized",
  "requestId": "req-uuid"
}
```
- **Cause**: Missing JWT token or invalid JWT signature
- **Action**: Provide a valid JWT token in the `Authorization: Bearer <token>` header

#### 403 Forbidden — Endpoint Not Available (Environment Gate)
```json
{
  "code": "STEL_010",
  "message": "This endpoint is only available on testnet. Current deployment is configured for mainnet",
  "requestId": "req-uuid"
}
```
- **Cause**: Endpoint invoked on a mainnet deployment
- **Action**: This endpoint is testnet-only. Ensure you're calling the correct environment.

#### 429 Too Many Requests — Rate Limited

**By caller (RateLimitGuard):**
```json
{
  "code": "SYS_008",
  "message": "Rate limit exceeded",
  "limit": 10,
  "ttlSeconds": 60,
  "retryAfterSeconds": 45,
  "requestId": "req-uuid"
}
```

**By Friendbot (account already recently funded):**
```json
{
  "code": "STEL_008",
  "message": "This account was recently funded by Friendbot. Please try again later.",
  "retryAfterSeconds": 300,
  "requestId": "req-uuid"
}
```

#### 503 Service Unavailable — Friendbot Down
```json
{
  "code": "STEL_007",
  "message": "Friendbot is temporarily unavailable. Please try again later.",
  "requestId": "req-uuid"
}
```
- **Cause**: Stellar's Friendbot service is temporarily down
- **Action**: Retry after a delay (typically a few minutes)

## Security Safeguards

This implementation includes multiple load-bearing security guarantees. **Each one is essential**; removing any would weaken the endpoint significantly.

### 1. Environment Gate (CRITICAL)

**What**: Hard check that the app is configured for testnet before any Friendbot call.

**Implementation** (see `testnet-bootstrap.service.ts`):
```typescript
const stellarConfig = this.configService.getStellarConfig();
if (stellarConfig.network !== 'testnet') {
  throw new ForbiddenException({
    code: ErrorCode.STEL_TESTNET_ONLY,
    message: 'This endpoint is only available on testnet...'
  });
}
```

**Why it matters**: 
- Checks against the actual Stellar network configuration, not a generic `NODE_ENV` flag
- `NODE_ENV=development` can exist on staging or production (a weak signal)
- The app's `STELLAR_NETWORK` env var directly controls network behavior
- Fails closed: if network config is `undefined` or unset, the check fails (rejects the request)

**Note**: Even if this guard were somehow bypassed (e.g., removed or misconfigured), the hardcoded Friendbot URL (safeguard #2) prevents the call from reaching a different network.

### 2. Hardcoded Friendbot URL (CRITICAL)

**What**: Friendbot's testnet URL is hardcoded in the service and never derived from config or request input.

**Implementation** (see `testnet-bootstrap.service.ts`):
```typescript
const FRIENDBOT_TESTNET_URL = 'https://friendbot.stellar.org';
const FRIENDBOT_FUND_PATH = '/';
// Never modified, never accepted as a parameter
```

**Why it matters**:
- Prevents accidental or malicious redirection to a fake Friendbot or different network
- Even if environment gate is bypassed, this ensures calls only hit Stellar's real testnet Friendbot
- A configurable URL would be a critical vulnerability (could fund mainnet accounts via relaying)

**Never acceptable**:
- Accepting Friendbot base URL as an environment variable
- Accepting Friendbot URL in the request body
- Deriving the URL from a mutable config store
- Allowing URL overrides via dependency injection

### 3. Authentication

**Mechanism**: JWT + Role-based access control

**Guards**:
- `JwtAuthGuard`: Verifies JWT signature and presence
- `@Roles(UserRole.ADMIN, UserRole.DEVELOPER)`: Restricts to authorized roles

**Implementation**:
```typescript
@UseGuards(JwtAuthGuard, RateLimitGuard)
@Roles(UserRole.ADMIN, UserRole.DEVELOPER)
@Controller('dev/testnet-bootstrap')
export class TestnetBootstrapController { ... }
```

**Why it matters**:
- Prevents unauthenticated callers from funding arbitrary accounts
- Ties funding requests to a specific authenticated identity (logged)
- Integrates with the app's existing JWT/RBAC infrastructure (no new auth scheme)

### 4. Input Validation

**Validator**: `@IsStellarAddress()` decorator on the DTO field

**Implementation** (reuses existing validator):
```typescript
export class TestnetBootstrapRequestDto {
  @IsNotEmpty()
  @IsStellarAddress()  // Validates Ed25519 public key format
  publicKey: string;
}
```

**Why it matters**:
- Rejects malformed keys before any external call to Friendbot
- Uses the app's existing `StrKey.isValidEd25519PublicKey()` utility (no new validation logic)
- Protects against accidental typos and format confusion

### 5. Rate Limiting

**Mechanism**: `RateLimitGuard` (Redis-backed via Keyv + fallback to in-memory)

**Default Profile** (inherited from app config):
```
Limit: 10 requests per 60 seconds per authenticated user
Block duration: 60 seconds
Tracked by: Authenticated user ID (when available)
```

**Where to adjust**: Environment variables (see "Configuration" below)

**Why it matters**:
- Prevents a single user from repeatedly hammering Friendbot
- Per-user tracking ensures one user's abuse doesn't block others
- Configurable thresholds allow adjustment without code changes

### 6. Friendbot Failure Handling

**Distinct error codes** surface different failure modes:

| HTTP Status | Error Code | Meaning | User Action |
|---|---|---|---|
| 400 | `STEL_004` | Invalid public key (before Friendbot call) | Check key format |
| 400 | `STEL_009` | Friendbot rejected (other 400 reason) | Inspect Friendbot error |
| 429 | `STEL_008` | Account already recently funded | Retry after ~5 minutes |
| 503 | `STEL_007` | Friendbot is down | Retry later |

**Implementation**: Service's `handleFriendBotError()` method distinguishes between error types before returning to client.

## Configuration

### Environment Variables

**Network Configuration** (required):
```bash
STELLAR_NETWORK=testnet  # Must be "testnet" for endpoint to function
```

**Rate Limiting** (optional, uses defaults if not set):
```bash
# Per-profile rate limit overrides (milliseconds)
RATE_LIMIT_AUTH_LIMIT=10                  # Requests per period
RATE_LIMIT_AUTH_TTL_MS=60000              # Rate-limit window
RATE_LIMIT_AUTH_BLOCK_MS=60000            # Block duration after limit exceeded

# Note: Adjust the profile/thresholds in src/common/rate-limit/rate-limit.config.ts
# if you want a different default
```

### Rate Limit Thresholds (Code-Level)

To customize rate limits for this endpoint specifically, edit:
```
src/common/rate-limit/rate-limit.config.ts
```

Current defaults (per authenticated user):
- **Limit**: 10 requests
- **Window (TTL)**: 60 seconds
- **Block Duration**: 60 seconds

### Abuse Prevention Window

**Per-account Friendbot throttling** is implemented by Friendbot itself (~5 minutes per account). The endpoint surfaces this as a distinct 429 response with `retryAfterSeconds: 300`.

**Future enhancement** (not currently implemented, but mentioned in spec):
Could add server-side per-target-public-key throttling to further protect Friendbot's rate limits. This would require stateful tracking (Redis cache) and is deemed out-of-scope for this initial implementation.

## Usage Examples

### cURL

```bash
curl -X POST http://localhost:3000/dev/testnet-bootstrap/fund \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I"
  }'
```

### TypeScript/JavaScript

```typescript
const response = await fetch('http://localhost:3000/dev/testnet-bootstrap/fund', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    publicKey: 'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I',
  }),
});

const data = await response.json();
console.log(data);
```

## Testing

### Unit Tests

Located in:
- `src/stellar/services/testnet-bootstrap.service.spec.ts` — Service layer tests
- `src/stellar/controllers/testnet-bootstrap.controller.spec.ts` — Controller layer tests

**Coverage**:
- ✅ Happy path: Valid testnet key, successful funding
- ✅ Environment gate: Rejected on mainnet, unset network config
- ✅ Auth: Unauthenticated/unauthorized callers rejected
- ✅ Input validation: Malformed public keys rejected before Friendbot call
- ✅ Rate limiting: Exceeding limit returns 429
- ✅ Friendbot failures: Already-funded (429), unavailable (503), network errors
- ✅ Hardcoded URL verification: URL cannot be overridden
- ✅ Error responses: Distinct error codes for each failure mode

### Running Tests

```bash
# Run all stellar tests
npm run test -- stellar

# Run only testnet-bootstrap tests
npm run test -- testnet-bootstrap

# With coverage
npm run test -- --coverage testnet-bootstrap
```

### Integration Testing

To manually test against a real testnet deployment:

1. Generate a fresh Stellar keypair:
   ```bash
   npm run stellar-keygen
   # Output: Public Key: G..., Secret Key: S...
   ```

2. Call the endpoint with your JWT token:
   ```bash
   curl -X POST http://your-testnet-deployment/dev/testnet-bootstrap/fund \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"}'
   ```

3. Verify the account was funded:
   ```bash
   # Use stellar-cli or Horizon API
   stellar account info GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

## Implementation Details

### File Structure

```
src/stellar/
├── controllers/
│   ├── testnet-bootstrap.controller.ts           (new)
│   ├── testnet-bootstrap.controller.spec.ts      (new)
│   └── matching-pool-admin.controller.ts
├── services/
│   ├── testnet-bootstrap.service.ts              (new)
│   ├── testnet-bootstrap.service.spec.ts         (new)
│   └── ...
├── dto/
│   ├── testnet-bootstrap.dto.ts                  (new)
│   └── ...
└── stellar.module.ts                             (updated)

src/common/enums/
└── error-code.enum.ts                            (updated)
```

### Key Dependencies

- `axios` — HTTP client for calling Friendbot
- `@stellar/stellar-sdk` — `StrKey` for public key validation
- `class-validator` — DTO validation decorators
- `@nestjs/jwt` — JWT authentication (existing)
- `keyv` + `@keyv/redis` — Rate limiting storage (existing)

### Changes to Existing Files

1. **`src/common/enums/error-code.enum.ts`**:
   - Added: `STEL_FRIENDBOT_ALREADY_FUNDED = 'STEL_008'`
   - Added: `STEL_FRIENDBOT_FAILED = 'STEL_009'`
   - Added: `STEL_TESTNET_ONLY = 'STEL_010'`

2. **`src/stellar/stellar.module.ts`**:
   - Registered: `TestnetBootstrapController`
   - Registered: `TestnetBootstrapService`
   - Exported: `TestnetBootstrapService`

## FAQ

**Q: Why is the Friendbot URL hardcoded and not configurable?**

A: A configurable URL would create a critical vulnerability: an attacker could redirect funding to a different endpoint or use this as a relay to access mainnet. Hardcoding eliminates this class of attack entirely.

**Q: Why check STELLAR_NETWORK instead of NODE_ENV?**

A: `NODE_ENV=development` can exist on staging and production servers. The actual Stellar network configuration is determined by the `STELLAR_NETWORK` env var, which is the canonical source of truth for network context. This prevents accidents where development code is accidentally run against production infrastructure.

**Q: What if someone removes the @Roles() guard?**

A: The endpoint still requires JWT authentication (`JwtAuthGuard`), so it's not fully open. Additionally, the environment gate in the service (checking `STELLAR_NETWORK`) would catch any calls on mainnet.

**Q: Can this endpoint be used to fund mainnet accounts?**

A: No. Multiple safeguards prevent this:
1. Environment gate checks `STELLAR_NETWORK !== 'testnet'` and rejects
2. Hardcoded Friendbot URL ensures calls only hit `https://friendbot.stellar.org` (testnet-only)
3. Even if both guards failed, Friendbot itself would reject mainnet public keys (they don't exist in Friendbot's network)

**Q: How does rate limiting work?**

A: Per-caller (per authenticated user by default). The `RateLimitGuard` tracks requests via the user ID and enforces the configured limit. After hitting the limit, further requests are blocked for a configurable duration.

**Q: What happens if Friendbot is down?**

A: The endpoint returns 503 Service Unavailable with error code `STEL_007`. The caller should retry after a delay.

**Q: What if Friendbot rejects the account as already funded?**

A: The endpoint returns 429 Too Many Requests with error code `STEL_008` and a `retryAfterSeconds` guidance (typically 300 seconds = 5 minutes, which is Friendbot's rate-limit window).

## Versioning & Deprecation

This endpoint is intended to remain available for the lifetime of the testnet. If Stellar's Friendbot API changes, a new version or migration would be needed.

Potential future enhancements (out-of-scope for this implementation):
- Per-target-public-key rate limiting (to further reduce Friendbot abuse)
- Caching of recently-funded accounts (to reduce redundant Friendbot calls)
- Metrics & alerting on Friendbot failures
- Support for other testnet funding mechanisms (if Stellar adds alternatives)

## Support & Reporting Issues

If you encounter issues with this endpoint:

1. **Verify environment**: Check that `STELLAR_NETWORK=testnet` in your deployment
2. **Check JWT**: Ensure your JWT token is valid and includes appropriate roles (ADMIN or DEVELOPER)
3. **Inspect error code**: Reference the error response codes table above
4. **Check Friendbot**: Verify Stellar's testnet Friendbot is accessible: `curl https://friendbot.stellar.org/`
5. **File an issue**: Include the error code, request ID, and steps to reproduce

---

**Issue Reference**: #843  
**Last Updated**: 2026-07-25  
**Maintainer**: Backend Team
