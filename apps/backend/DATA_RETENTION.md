# Data retention and deletion for user records

This document is the inventory the erasure flow is driven from. It answers two
questions for every backend store that can hold user-identifiable data:

1. how long the data is kept while the account is active, and
2. what happens to it when the account holder asks to be erased.

The machine-readable copy of the same inventory lives in
[`src/data-retention/user-data-inventory.ts`](./src/data-retention/user-data-inventory.ts);
`UserDataDeletionService` iterates it, so a new user-keyed table is only covered
once it is added there. `DATA_RETENTION.md` and the code must move together.

## Inventory

`null` retention means the row lives for the lifetime of the account and is
only removed by the erasure flow (or by the store's own cleanup job, where one
exists).

| Store                            | Holds                                              | Retention                                  | On erasure    |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------ | ------------- |
| `users`                          | Account: email, names, bio, avatar, wallet, 2FA     | Account lifetime                           | **anonymise** |
| `stellar_accounts`               | Linked Stellar wallets                             | Account lifetime                           | delete        |
| `refresh_tokens`                 | Sessions and refresh tokens (device, IP)           | 30 days after expiry                       | delete        |
| `password_reset_tokens`          | Password reset tokens                              | Until expiry / use (max 24h)               | delete        |
| `notification_preferences`       | Channel and category preferences                   | Account lifetime                           | delete        |
| `push_tokens`                    | Device push tokens and device ids                  | 90 days since last registration            | delete        |
| `notifications`                  | In-app notifications addressed to the user         | 90 days                                    | delete        |
| `notification_delivery_logs`     | Delivery attempts per channel                      | 90 days                                    | delete        |
| `notification_suppression_logs`  | Suppressed notifications                           | 90 days                                    | delete        |
| `watchlist_items`                | Watchlisted assets/projects, notes                 | Account lifetime                           | delete        |
| `portfolio_snapshots`            | Point-in-time balances                             | 365 days                                   | delete        |
| `portfolio_materialized_snapshots` | Latest portfolio read model                      | Account lifetime (mirror)                  | delete        |
| `portfolio_assets`               | Tracked asset balances                             | Account lifetime                           | delete        |
| `portfolio_anomalies`            | Anomaly detections and reviewer notes              | 365 days                                   | delete        |
| `price_alert_rules`              | Price alert rules                                  | Account lifetime                           | delete        |
| `price_alert_evaluation_logs`    | Alert evaluation history                           | 90 days                                    | delete        |
| `export_jobs`                    | Generated exports, including inline CSV payloads   | 30 days                                    | delete        |
| `audit_logs`                     | User-activity audit trail                          | 365 days (`AUDIT_RETENTION.md`)            | **anonymise** |
| `audit_log_archive`              | Archived audit rows                                | 2555 days (7 years)                        | **anonymise** |
| `admin_blockchain_audit_logs`    | On-chain admin actions                             | 2555 days (7 years)                        | **anonymise** |
| `content_reports`                | Reports filed or reviewed by the user              | 2555 days (7 years)                        | **anonymise** |
| `review_comments`                | Moderation review comments                         | 2555 days (7 years)                        | **anonymise** |
| `review_decision_history`        | Moderation decisions                               | 2555 days (7 years)                        | **anonymise** |
| `verification_requests`          | Verification requests and evidence                 | 2555 days (7 years)                        | **anonymise** |
| `outbox_events`                  | Transactional outbox payloads                      | Processed within minutes; DLQ 30 days      | **anonymise** |

Stores that are not keyed by user id are called out in
[Known limitations](#known-limitations).

## Why audit and moderation records are anonymised, not deleted

Deleting a user leaves a hole in the trail that is supposed to prove *that* the
deletion happened, who acted on-chain, and which moderation decisions were
taken. The backend therefore keeps those rows and removes only the personal
data from them:

- `audit_logs`: `userId` and `ipAddress` are set to `NULL`; personal keys inside
  `metadata` (email, names, tokens, wallet addresses, ...) are replaced with
  `[redacted]` recursively. The action and timestamp survive.
- `audit_log_archive`: the archived copy of each of those rows is redacted the
  same way.
- `admin_blockchain_audit_logs`: `actorId` is replaced by a one-way hash
  (`anon:<sha256-32>`), `actorEmail` and `paramsSummary` are cleared.
- `content_reports`, `review_comments`, `review_decision_history`,
  `verification_requests`: the row and its foreign key are kept so the
  moderation trail stays joinable, but the free text that can embed PII
  (description, review notes, comment body, rationale, evidence) is redacted or
  cleared.

Keeping a foreign key that points at the anonymised tombstone user is not
identifying: the tombstone has no email, name, wallet, avatar or 2FA secret, so
the reference is pseudonymous at worst.

## The erasure flow

`UserDataDeletionService.deleteUserData(userId)`:

1. locks the user row (`SELECT ... FOR UPDATE`) and returns early if
   `users.deletedAt` is already set, so the call is idempotent;
2. in **one transaction**, walks the inventory and deletes or anonymises every
   store — including the account row itself, whose profile columns are nulled,
   whose 2FA is disabled and whose preferences are reset to defaults before
   `deletedAt` is set to `now()`;
3. after the transaction commits, writes a `user.data.deletion` record to
   `audit_logs`. That record has no `userId`; its metadata carries a one-way
   `anon:<sha256-32>` subject, the per-table row counts and nothing else.

Because the tombstone and the store cleanups commit together, a crash leaves
the account untouched rather than half-erased. The erasure is audited only
after it has committed, so the trail never claims a rollback that did not
happen.

`JwtStrategy.validate` rejects any account whose `deletedAt` is set, so tokens
issued before the erasure stop working immediately.

### Running it

```
# from apps/backend
npx ts-node scripts/delete-user-data.ts <user-id>
# or, from a build
node dist/scripts/delete-user-data.js <user-id>
```

The service is exported from `DataRetentionModule`, so an admin endpoint can be
layered on later without changing the erasure logic.

## Tests

- `src/data-retention/user-data-inventory.spec.ts` — the inventory is unique,
  complete, and every audit store is anonymised; redaction and subject hashing.
- `test/db-e2e/user-data-deletion.dbspec.ts` — seeds a row in every store,
  runs the flow against a migrated Postgres database and asserts that no
  identifiable data survives, the audit trail is de-identified, the deletion is
  itself audited, the old token stops working and a second run is a no-op.

## Known limitations

- `idempotency_records.responseBody` can echo a response body (which may contain
  an email) until the record's `expiresAt`. The table has no user column, so it
  cannot be reached from the inventory; it expires on its own and is cleaned by
  the idempotency scheduler.
- `telegram_subscriptions` is keyed by Telegram `chatId`, not by the platform
  user id, so it is out of scope for this inventory. Unlinking Telegram is a
  separate flow.
- `audit_log_archive` rows whose payload does not carry a `userId` (for
  example admin-blockchain records archived by a different policy) are not
  matched by the archive handler.
