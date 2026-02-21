# feat(auth): implement password reset with one-time tokens

## Summary

Closes #329

Adds a secure password reset flow using one-time reset tokens. Users can request a reset link via email, then use the token to set a new password. The token is immediately invalidated after use.

## What was implemented

- **`POST /auth/forgot-password`** — Accepts an email address, generates a cryptographically secure reset token, and logs it (email sending is mocked). Returns a generic message regardless of whether the email exists.
- **`POST /auth/reset-password`** — Accepts a reset token and a new password. Validates the token, hashes the new password with bcrypt, persists it, and invalidates the token in a single flow.
- **`PasswordResetToken` entity** — New TypeORM entity (`password_reset_tokens` table) storing the SHA-256 hash of each token, the associated user ID (FK with cascade delete), expiry timestamp, and usage timestamp.
- **Database migration** — `1769500000000-CreatePasswordResetTokens` creates the table with indexes on `tokenHash` and `userId`.
- **DTOs with validation** — `ForgotPasswordDto` (email) and `ResetPasswordDto` (token + newPassword with 8–128 char constraint) using `class-validator`.

## Technical details

- Raw tokens are generated via `crypto.randomBytes(32)` and only the SHA-256 hash is stored in the database—the raw value is never persisted.
- When a user requests a new reset token, all previous unused tokens for that user are bulk-invalidated before the new one is created.
- Token expiry is set to 1 hour. Expired tokens are marked as used on access so they cannot be retried.
- The `AuthModule` now registers `TypeOrmModule.forFeature([User, PasswordResetToken])` to provide both repositories to `AuthService`.
- Email sending is mocked via `Logger.log()`. Integrating a real mail transport (e.g. nodemailer, SendGrid) is a follow-up task.

## Security considerations

- **No email enumeration** — `POST /auth/forgot-password` always returns the same generic message (`"If that email is registered, a reset link has been sent."`) whether or not the email exists.
- **Token hashing** — Only the SHA-256 digest is stored; a database leak does not expose usable tokens.
- **One-time use** — Tokens are invalidated immediately after a successful password reset. Reuse attempts return a `400 Bad Request`.
- **Time-limited** — Tokens expire after 1 hour. Attempting to use an expired token also marks it as consumed.
- **Previous token invalidation** — Requesting a new token invalidates all outstanding tokens for that user.
- **Input validation** — Email format, password length (8–128), and non-empty token are validated at the DTO layer before reaching service logic.
- **Password hashing** — New passwords are hashed with bcrypt (10 salt rounds) before storage.

## How it was tested

- **10 unit tests** in `src/auth/auth.service.spec.ts` covering:
  - Generic response for non-existent email
  - Token generation and persistence for existing users
  - Previous token invalidation on new request
  - Email normalisation (lowercase + trim)
  - Invalid token rejection
  - Expired token rejection (with mark-as-used side effect)
  - Deleted user edge case
  - Password hashing and user save
  - Token invalidation after successful reset
  - Token reuse prevention
- Swagger documentation added for both endpoints.

## Checklist

- [x] Code follows existing NestJS/TypeORM patterns in the repo
- [x] DTOs use `class-validator` decorators consistent with existing DTOs
- [x] Swagger `@ApiOperation` / `@ApiResponse` decorators added
- [x] Migration created for new table
- [x] Unit tests written and passing (10/10)
- [x] No existing tests broken
- [x] No new dependencies added
- [x] No breaking changes to existing endpoints

