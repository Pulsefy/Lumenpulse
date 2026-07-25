# Cross-contract view helpers

This crate centralizes the common pattern for read-only cross-contract calls in the Soroban workspace.

## Intended usage

- Use `read_u64_view` for view functions returning `u64` values such as reputation.
- Use `read_bool_view` for boolean view functions such as registration checks.
- Keep the shared helper as the only place that directly invokes `env.invoke_contract` for read-only access.

## Error handling

The helper returns a structured `ViewError` instead of allowing a raw contract-call panic to escape. Contract modules should map that shared error into their own contract-specific error enum so callers get a consistent, documented failure mode.
