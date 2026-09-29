# Audit log retention and export

The backend writes two audit trails:

- `audit_logs`: user actions recorded by `AuditLogInterceptor` (logins, password resets, profile changes) and the audit subsystem's own `audit.*` actions.
- `admin_blockchain_audit_logs`: admin actions that touched on-chain contracts, recorded by `AdminAuditInterceptor`.

Each record belongs to one **record type**, and each type has its own retention window.

## Retention windows

| Record type               | Source rows                                                                              | Default window      | Default mode | Env prefix               |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------- | ------------ | ------------------------ |
| `user_activity`           | `audit_logs` where `action` does not start with `audit.`                                 | 365 days            | `archive`    | `AUDIT_USER_ACTIVITY`    |
| `audit_operation`         | `audit_logs` where `action` starts with `audit.` (`audit.export`, `audit.retention.run`) | 2555 days (7 years) | `archive`    | `AUDIT_OPERATION`        |
| `admin_blockchain_action` | `admin_blockchain_audit_logs`                                                            | 2555 days (7 years) | `archive`    | `AUDIT_ADMIN_BLOCKCHAIN` |

Override a window or mode per type with `<PREFIX>_RETENTION_DAYS` (a positive integer) and `<PREFIX>_RETENTION_MODE` (`archive` or `purge`). The app refuses to start if either value is invalid, so a typo can't silently delete data.

The policy lives in [`src/audit/retention/audit-retention.policy.ts`](./src/audit/retention/audit-retention.policy.ts).

### The retention edge

A record is expired when `createdAt < now - retentionDays`. A record created exactly at the cutoff is still inside the window and is kept. It expires on the next run.

## The retention job

`AuditRetentionScheduler` runs at 03:00 UTC every day. It takes the shared `audit-retention` job lock, so only one instance runs it at a time, and it reports to the `job_runs` history like the other schedulers.

For each record type it processes expired rows oldest first, in batches of `AUDIT_RETENTION_BATCH_SIZE` (default 1000). Each run is capped at `AUDIT_RETENTION_MAX_BATCHES` (default 100) batches per type, and the next run picks up anything left over. What happens to a batch depends on the mode:

- `archive`: the rows are copied verbatim into `audit_log_archive` (as `payload`, with `recordType`, `sourceTable`, `sourceId`, `originalCreatedAt`) and then deleted from the source table. The copy and the delete run in one transaction.
- `purge`: the rows are deleted.

Each run writes an `audit.retention.run` entry to `audit_logs` with the cutoff and the archived or purged counts for each type.

| Variable                      | Default     | Purpose                         |
| ----------------------------- | ----------- | ------------------------------- |
| `AUDIT_RETENTION_ENABLED`     | `true`      | Set to `false` to pause the job |
| `AUDIT_RETENTION_CRON`        | `0 3 * * *` | Schedule (UTC)                  |
| `AUDIT_RETENTION_BATCH_SIZE`  | `1000`      | Rows per transaction            |
| `AUDIT_RETENTION_MAX_BATCHES` | `100`       | Batch cap per type per run      |

`audit_log_archive` itself is not pruned. Drop or move old archive rows through your normal data-lifecycle process.

## Exporting an extract for an auditor

```
GET /admin/audit-logs/export?from=2026-01-01T00:00:00Z&to=2026-03-31T23:59:59Z&actorId=<id>&recordType=<type>&format=csv
```

Only admins can call this endpoint (JWT + `ADMIN` role).

| Parameter    | Required | Notes                                                                                 |
| ------------ | -------- | ------------------------------------------------------------------------------------- |
| `from`, `to` | yes      | ISO 8601; both ends inclusive; `from` must not be after `to`                          |
| `actorId`    | no       | User id for `user_activity`/`audit_operation`, admin id for `admin_blockchain_action` |
| `recordType` | no       | One of the types above; all types when omitted                                        |
| `format`     | no       | `json` (default) or `csv` (downloaded as an attachment)                               |

Records from every matching type are merged into one shape (`recordType`, `id`, `actorId`, `action`, `ipAddress`, `details`, `createdAt`), oldest first. An extract holds at most `AUDIT_EXPORT_MAX_ROWS` (default 10000) records. If more match, `truncated` is `true` and you should narrow the date range. In CSV, cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets don't run them as formulas.

The export only reads live tables. To extract records that have already been archived, query `audit_log_archive` by `recordType` and `originalCreatedAt`.

### Exports are audited

Each export writes an `audit.export` entry to `audit_logs` with the requesting admin, their IP, the filters, the format and the row count. This entry is written before the extract is returned. If it can't be written, the export fails, so no extract leaves the system without a record.
