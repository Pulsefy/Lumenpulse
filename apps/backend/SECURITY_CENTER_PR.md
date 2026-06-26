# feat(auth): implement Security Center for session and device management

## Summary

Closes #529

Implements a Security Center that allows users to inspect active sessions and revoke suspicious devices. Provides API endpoints to list all active sessions (refresh tokens) and revoke specific ones.

## What was implemented

- **`GET /auth/sessions`** — Returns a list of active sessions for the authenticated user, including device information, IP address, creation date, expiration date, and a flag indicating if it's the current session.
- **`POST /auth/sessions/:id/revoke`** — Revokes a specific session (refresh token) by its ID. Only the owner can revoke their own sessions.
- **`AuthService.getActiveSessions(userId)`** — Service method that queries the database for non-revoked, non-expired refresh tokens.
- **`AuthService.revokeSession(sessionId, userId)`** — Service method that revokes a specific refresh token after verifying ownership.
- **DTOs** — `SessionDto`, `ActiveSessionsResponseDto`, `RevokeSessionResponseDto` with proper validation and Swagger documentation.
- **Unit tests** — Added 7 comprehensive tests covering both service methods.

## Technical details

- Active sessions are determined by querying `refresh_tokens` where `revokedAt IS NULL` and `expiresAt > NOW()`.
- Sessions are ordered by `createdAt DESC` (most recent first).
- Revocation sets the `revokedAt` timestamp to the current time.
- The `isCurrent` flag in `SessionDto` is currently set to `false` for all sessions. Future enhancement: embed a session identifier in the JWT to accurately mark the current session.
- No database migrations required; uses existing `refresh_tokens` table which already stores `deviceInfo` and `ipAddress`.

## Security considerations

- **Authorization** — Users can only revoke their own sessions; the service verifies that the session belongs to the requesting user.
- **Idempotency** — Revoking an already-revoked session returns a success response without side effects.
- **Information disclosure** — Attempting to revoke a non-existent or unauthorized session returns a `404 Not Found` to avoid revealing session existence.
- **Session enumeration** — The list endpoint only returns sessions for the authenticated user.
- **Input validation** — Session ID is validated as a UUID by the route parameter; userId is taken from the authenticated JWT.

## How it was tested

- **7 unit tests** added to `src/auth/auth.service.spec.ts`:
  - `getActiveSessions` returns correctly mapped sessions with proper query parameters
  - `getActiveSessions` returns empty list when no active sessions
  - `revokeSession` successfully revokes an active session
  - `revokeSession` is idempotent for already-revoked sessions
  - `revokeSession` throws `NotFoundException` for non-existent session
  - `revokeSession` throws `NotFoundException` when session belongs to another user
- All existing tests continue to pass (no breaking changes).
- Swagger documentation generated for new endpoints.

## Checklist

- [x] Code follows existing NestJS/TypeORM patterns
- [x] DTOs use `class-validator` and Swagger decorators consistent with existing DTOs
- [x] Endpoints protected with `JwtAuthGuard`
- [x] Unit tests added and passing
- [x] No new dependencies added
- [x] No breaking changes to existing endpoints
- [x] No database migration needed (uses existing schema)
