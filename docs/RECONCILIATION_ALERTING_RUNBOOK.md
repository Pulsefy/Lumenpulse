# Reconciliation Alerting Runbook

Reconciliation alerts identify differences between live Stellar balances and the `portfolio_assets` read model.

## Configuration

Set these backend environment variables in the same units as the stored asset amount:

- `RECONCILIATION_PORTFOLIO_ASSETS_WARNING_THRESHOLD` (default: `0.0000001`)
- `RECONCILIATION_PORTFOLIO_ASSETS_CRITICAL_THRESHOLD` (default: `0.00001`)

The critical threshold must be greater than or equal to the warning threshold.

## Response

1. Inspect the `dataset` and `severity` labels on `lumenpulse_reconciliation_drift_total`.
2. Query recent reconciliation jobs at `GET /admin/reconciliation` and inspect `driftDetails` for `userId`, asset code, issuer, stored amount, upstream amount, delta, and repair status.
3. Confirm the corresponding Stellar account and determine whether the read model or upstream balance is authoritative.
4. Re-run reconciliation after correcting the underlying cause and verify that the alert clears.