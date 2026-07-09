# Cross Contract View Helpers

This shared crate provides safe, standardized helpers for read-only cross-contract calls in Soroban.

## Usage

- `invoke_view0(env, contract, fn_name)` for zero-argument view functions.
- `invoke_view1(env, contract, fn_name, arg)` for single-argument view functions.

### Error handling

All helpers return `Result<T, ViewCallError>`:

- `ContractNotSet` when the target address is empty.
- `CallFailed` when the invocation itself fails.
- `InvalidResponse` when the result cannot be decoded.

### Example

```rust
let score: u64 = invoke_view1(env, &registry, &Symbol::new(env, "get_reputation"), voter.clone())?;
```
