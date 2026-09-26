# Secret rotation runbook (no restart)

`apps/backend/src/lib/config.ts` validates the environment once at boot and then
freezes it, so an edited environment variable is invisible to a running
process. `SecretRotationService` adds a small in-memory version history so a
shared secret can be rotated while the process keeps serving traffic.

## What can be rotated

Only shared/verification secrets whose consumers can honour an overlap window:

| Name | Config source | Consumed by |
| --- | --- | --- |
| `CONTRACT_ADMIN_API_KEY` | `CONTRACT_ADMIN_API_KEY` | `AccessControlService.verifyApiKey` |
| `WEBHOOK_SECRET` | `WEBHOOK_SECRET` | webhook signature verification |
| `SOROBAN_INGEST_SECRET` | `SOROBAN_INGEST_SECRET` | Soroban event ingestion |
| `DRIFT_ALERT_INGEST_SECRET` | `DRIFT_ALERT_INGEST_SECRET` | drift-alert ingestion |
| `PYTHON_API_KEY` | `PYTHON_API_KEY` | data-processing API calls |

Database credentials, the JWT signing secret and the Stellar server secret are
**not** in this list: they are bound to a connection pool or a signing strategy
at boot, so rotating them still needs a rolling restart. Use this runbook for
the secrets above only.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_ROTATION_TRIGGER_TOKEN` | *(unset)* | Shared token for the trigger. **The endpoint returns 503 until this is set.** |
| `SECRET_ROTATION_OVERLAP_MS` | `86400000` (24h) | Default window during which the previous value is still accepted. |

## Trigger

The endpoint is intentionally **excluded from the published OpenAPI document**
(`@ApiExcludeController`) so the public contract does not advertise a secrets
surface. It is documented here instead.

```
GET  /v1/config/admin/secrets          # rotation status, never values
POST /v1/config/admin/secrets/rotate   # rotate one secret
```

Both require the header:

```
X-Secret-Rotation-Token: <SECRET_ROTATION_TRIGGER_TOKEN>
```

Rotate:

```bash
curl -sS -X POST https://api.lumenpulse.io/v1/config/admin/secrets/rotate \
  -H "X-Secret-Rotation-Token: $SECRET_ROTATION_TRIGGER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name": "CONTRACT_ADMIN_API_KEY",
    "value": "<new value>",
    "actor": "ops@lumenpulse.io",
    "reason": "quarterly rotation",
    "overlapMs": 86400000
  }'
```

`overlapMs` is optional and bounded to 30 days. `actor` is required so the
audit entry names who rotated the value.

## Procedure

1. Generate the new secret (`openssl rand -hex 32`).
2. Publish it to the secret manager and update the deployment secret so a later
   restart keeps the new value.
3. Call the trigger above. The response contains identifiers only — `secretId`,
   `previousSecretIds`, `overlapExpiresAt`, `rotatedAt`, `auditLogId`.
4. Confirm with `GET /v1/config/admin/secrets` that `version` increased and
   `overlapExpiresAt` is in the future.
5. Update every other service that uses the old value to the new one **within
   the overlap window**. The old value stops verifying when the window elapses.
6. After the window, `previousSecretIds` is empty and the old value is rejected.

## Guarantees

- **No restart.** The swap is an in-memory, synchronous map write; nothing
  reads `process.env` during verification.
- **In-flight requests are unaffected.** The previous value keeps verifying for
  the whole overlap window, and the frozen `config` object is never mutated.
- **Audited.** Every swap writes an `AuditLog` with action `secrets.rotate`,
  the actor, the source IP, and metadata (`secretName`, `version`,
  `activeSecretId`, `previousSecretIds`, `overlapMs`, `reason`). The value is
  never written to the audit log or the logs.
- **Atomic.** If the audit write fails the swap is rolled back, so an unlogged
  rotation cannot happen.

## Rollback

Call the trigger again with the old value to make it active again. The
current value becomes the previous one for an overlap window, so both keep
verifying until the rollback window elapses.
