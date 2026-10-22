# Idempotency Guard Storage Cost Report

## Summary
Each guarded operation stores **one persistent entry** (~64 bytes) with 14-day TTL.

## Per-Operation Cost
- **Key**: 32 bytes (BytesN<32>)
- **Value**: ~4 bytes (boolean)
- **Total**: ~64 bytes including protocol overhead
- **Mainnet cost**: < 0.001 XLM per operation

## Storage Growth
- Linear: N operations = N × 64 bytes
- 1M operations ≈ 64 MB ledger state
- Auto-expires after 14 days (LEDGER_BUMP)

## TTL Configuration
- **LEDGER_THRESHOLD**: 120,960 ledgers (~7 days)
- **LEDGER_BUMP**: 241,920 ledgers (~14 days)

## Test Coverage
- ✅ Single entry per unique operation
- ✅ Rejected duplicates don't add storage
- ✅ TTL behavior documented and verified
