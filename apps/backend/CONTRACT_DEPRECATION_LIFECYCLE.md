# Contract Deprecation & Sunset Lifecycle

This document describes the lifecycle used to retire a deployed
contract without breaking existing users. It is meant to be read
alongside the deployment playbook.

## States

Every contract recorded in a manifest has a lifecycle state:

| State        | New writes | Exits (withdrawals) | In active manifest |
|--------------|------------|--------------------|---------------------|
| `active`    | allowed    | allowed             | yes                   |
| `deprecated` | blocked    | allowed             | yes                   |
| `sunset`    | blocked    | allowed             | no (removed)          |

- `active` — the default state for any contract that appears in a
  manifest's `contracts` map.
- `deprecated` — the contract is still deployed and users can exit,
  but new writes are rejected. This is the state to use when a
  replacement is ready but you want to give users time to migrate.
- `sunset` — the contract has been removed from the active
  manifest's `contracts` map. The lifecycle record is retained for
  audit purposes.

## Audit Trail

Every transition appends an entry to the contract's lifecycle
audit trail. Each entry records the contract key, the previous and
new state, the actor that performed the transition, an optional
reason, and a timestamp. The audit trail is stored in the
`lifecycle` jsonb column of the manifest record.

## Authorisation

All lifecycle transitions are exposed as admin-only endpoints on the
contract manifest controller. They require the `JWT_SECURITY_SCHEME`
or `API_KEY_SECURITY_SCHEME` and the `ADMIN` role, and they are
guarded by the contract admin guards.

## API

The following endpoints are available under `/v1/contracts/manifests`:

- `POST /contracts/deprecate` — mark a contract as deprecated.
  Body: `{ "contractKey": "treasury", "reason": "replaced by v2" }`.
- `POST /contracts/restore` — revert a deprecated contract back to
  active. Body: `{contractKey, reason}`.
- `POST /contracts/sunset` — mark a contract as sunset and remove
  it from the active manifest. Body: `{contractKey, reason}`.
- `GET /contracts/:contractKey/lifecycle` — return the lifecycle
  record and audit trail for a contract.

## Write Gating

Writes against a contract must be gated by calling
`DeploymentManifestService.assertWritesAllowed(contractKey, environment)`
before any state-changing operation. This method throws a
`BadRequestException` when the contract is deprecated or sunset.
Exits (withdrawals) must not be gated by this method.

## Playbook Steps

1. **Deploy the replacement.** Ensure the new contract is deployed
   and recorded in the manifest before deprecating the old one.
2. **Deprecate the old contract.** Call `POST /contracts/deprecate`
   with a reason. New writes are now blocked, but users can still
   exit.
3. **Monitor exits.** Watch the contract's activity until all
   users have migrated or withdrawn.
4. **Sunset the contract.** Call `POST /contracts/sunset` to remove
   the contract from the active manifest. The lifecycle record is
   retained for audit purposes.

## Rollback

If a deprecation was made in error, call `POST /contracts/restore`
to revert the contract to active. The rollback is audited just like
any other transition.

## Sunset Removal

After sunset, the contract key is removed from the active manifest's
`contracts` map. The lifecycle record (including the full audit
trail) remains queryable via `GET /contracts/:contractKey/lifecycle`
so operators can still inspect the history of the retired contract.
