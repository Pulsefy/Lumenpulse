/**
 * Names shared between the runtime Swagger UI (`main.ts`), the committed
 * `openapi.json` generator (`scripts/generate-openapi.ts`) and controller
 * decorators. Changing one of these values changes the published contract.
 */

/** Security scheme for user/admin JWTs sent as `Authorization: Bearer <jwt>`. */
export const JWT_SECURITY_SCHEME = 'JWT-auth';

/** Security scheme for service-to-service callers sent as `X-API-Key`. */
export const API_KEY_SECURITY_SCHEME = 'api-key';

/** Security scheme for inbound webhook deliveries signed with HMAC. */
export const WEBHOOK_SIGNATURE_SECURITY_SCHEME = 'webhook-signature';

/** Client-supplied key that makes a write safely retryable (see IdempotencyInterceptor). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Correlation id echoed on every response (see RequestIdMiddleware). */
export const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id';

/** Component names for the shared error schemas. */
export const ERROR_RESPONSE_SCHEMA = 'ErrorResponseDto';

/** HTTP methods that go through the idempotency interceptor. */
export const IDEMPOTENT_METHODS = ['post', 'put', 'patch', 'delete'] as const;

/** Committed spec location, relative to `apps/backend`. */
export const OPENAPI_ARTIFACT_PATH = 'openapi.json';

/** Pre-existing documentation gaps the lint tolerates, relative to `apps/backend`. */
export const OPENAPI_LINT_BASELINE_PATH = 'openapi-lint-baseline.json';
