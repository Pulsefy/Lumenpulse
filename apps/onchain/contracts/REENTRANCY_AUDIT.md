# Reentrancy Guard Audit

This table inventories entry points that perform external calls before completing state changes, the decision taken, and links to tests/docs.

- `crowdfund_vault`: already uses `reentrancy-guard` and wraps vulnerable entry points with `with_reentrancy_guard`. Tests present: see contract README and tests.
- `treasury`: already uses `reentrancy-guard` and protects fund-moving functions.
- `matching_pool`: already uses `reentrancy-guard` and protects `fund_pool`, `distribute_matching_funds`.
- `yield_vault`: added `reentrancy-guard` and protected `deposit`, `withdraw`, and `harvest_yield`. Tests: added reentrancy test in `src/test.rs`.
- `liquidity_pool`: added `reentrancy-guard` and protected `add_liquidity` and `swap_exact_in`. `remove_liquidity` follows checks-effects-interactions and does not require the guard; documented as such. Tests: added `src/test.rs` with reentrancy check for `add_liquidity`.
- `stable_swap_pool`: added `reentrancy-guard` and protected `add_liquidity` and `swap`. `remove_liquidity` follows checks-effects-interactions and does not require the guard. Tests: added `src/test.rs` with reentrancy check for `add_liquidity`.

Notes:
- For functions that already updated state before doing external transfers (e.g. `remove_liquidity`), no guard was added; these are documented as following checks-effects-interactions.
- Each added guard uses the shared `reentrancy-guard` crate via `acquire`/`release` and maps failures to the contract's error type or `Symbol("reentrancy")` for symbol-based contracts.

See individual contract READMEs for more details and the tests in each contract's `src/test.rs` for assertion patterns.
