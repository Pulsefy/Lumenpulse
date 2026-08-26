# Error Code Allocation Scheme

## Overview

Each contract defines its own error enum with independently numbered variants. To ensure error codes are unique across all contracts and can be reliably diagnosed, each contract is assigned a distinct error code range.

## Allocation Ranges

| Contract | Range | Size | Current Usage |
|----------|-------|------|---------------|
| contributor_registry | 100-299 | 200 | 22 codes |
| crowdfund_vault | 300-499 | 200 | 39 codes |
| feature_flags | 500-599 | 100 | 4 codes |
| lumenpulse-curation | 600-699 | 100 | 10 codes |
| matching_pool | 700-899 | 200 | 21 codes |
| notification_broker | 900-999 | 100 | 4 codes |
| pricing_adapter | 1000-1099 | 100 | 7 codes |
| project_registry | 1100-1199 | 100 | 12 codes |
| protocol_registry | 1200-1299 | 100 | 8 codes |
| treasury | 1300-1499 | 200 | 22 codes |
| upgradable-contract | 1500-1599 | 100 | 8 codes |
| vesting-wallet | 1600-1699 | 100 | 11 codes |
| yield_vault | 1700-1799 | 100 | 9 codes |

## Rules

1. Each contract must use codes only within its allocated range
2. Codes must be unique across all contracts (no overlaps)
3. When adding new error variants, use the next available code in the contract's range
4. Never reuse a code that was previously assigned to a different variant
5. The allocation scheme reserves room for growth (current usage is well below range limits)

## Breaking Change Notice

This allocation scheme represents a breaking change. Error codes returned by contracts have changed from their original values (which all started from 1). Backend systems must be updated to use the new error code mappings via the generated `error_reference.json` file.

## Error Reference Generation

The `scripts/generate_error_reference.py` script parses all contract error enums and generates a comprehensive JSON mapping of error codes to their contract, enum, variant, and human-readable message. This file should be regenerated whenever error codes change.

## Overlap Detection

The `tests/error_code_overlap_test.py` script validates that no error codes overlap across contracts. This test should be run as part of CI to ensure the allocation scheme is maintained.
