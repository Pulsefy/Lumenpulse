# Idempotency Guard Storage Cost Report

## Summary

This document reports the storage cost per guarded operation for the idempotency-guard contract.

## Storage Cost Analysis

### Per-Operation Storage

Each guarded operation that passes the idempotency check stores exactly **one persistent ledger entry**:

- **Key**: `DataKey::ExecutionReceipt(BytesN<32>)` — 32 bytes
- **Value**: `true` (boolean) — minimal overhead (~4 bytes)
- **Total per entry**: ~64 bytes of ledger state (including protocol overhead)

### Storage Tier

Receipts are stored in **persistent storage** with TTL management:

- **LEDGER_THRESHOLD**: 120,960 ledgers (~7 days at 5s/ledger)
- **LEDGER_BUMP**: 241,920 ledgers (~14 days)
- After LEDGER_BUMP ledgers without access, entries are automatically evicted

### Cost Estimation

At Soroban mainnet storage rates (as of implementation):

- **Per operation**: < 0.001 XLM
- **1,000 operations**: ~0.064 MB ledger state, negligible cost
- **1,000,000 operations**: ~64 MB ledger state, linear accumulation

### Scalability Considerations

For high-throughput deployments (> 10k operations/day), consider:

1. **Shorter TTLs**: Reduce LEDGER_BUMP to expire receipts faster
2. **Off-chain pre-screening**: Use bloom filters to detect obvious duplicates before calling the contract
3. **Request ID compression**: Use shorter, domain-specific identifiers if 32 bytes is excessive

### Test Coverage

The storage cost behavior is verified in:

- `storage_cost_is_one_persistent_entry_per_operation`: Confirms exactly one entry per unique claim
- `storage_growth_scales_with_unique_operations`: Verifies linear growth with unique operations
- `repeated_call_is_rejected`: Confirms rejected duplicates do not add storage

### Verification Command

Run the test suite to verify storage behavior:

```bash
cargo test --package idempotency-guard
```

## Conclusion

The idempotency-guard contract uses minimal storage per operation (~64 bytes) with automatic TTL-based eviction after 14 days. This design provides robust duplicate protection with negligible per-operation cost while preventing unbounded storage growth through automatic expiry.
