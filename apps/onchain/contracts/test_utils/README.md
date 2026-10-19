# `test_utils` — shared Soroban test harness

`test_utils` collects the test scaffolding that every contract crate in this
workspace used to copy-paste: building an `Env`, mocking auths, generating
admin accounts, registering a Stellar Asset Contract, minting, and moving the
ledger forward.

It is a **dev-dependency only** — it is never linked into a deployed contract —
and it is deliberately *not* a workspace member (see the note in `Cargo.toml`),
because `soroban-sdk`'s `testutils` feature cannot be compiled for
`wasm32-unknown-unknown`.

## What it provides

| Helper | Purpose |
| --- | --- |
| `test_env()` | `Env::default()` with `mock_all_auths()` — the old two-line preamble of every test. |
| `account(env)` | A fresh random `Address`. |
| `register(env, contract, args)` / `register_contract(env, contract)` | `Env::register` with the constructor args handled. |
| `create_token(env, admin)` | A Stellar Asset Contract as `(TokenClient, StellarAssetClient)`. |
| `mint(admin, to, amount)` | Mint through the asset admin client. |
| `set_time` / `advance_time` / `timestamp` | Ledger timestamps. |
| `set_sequence` / `advance_sequence` | Ledger sequence numbers. |
| `TestEnv` | An owning harness bundling the env, an admin, a token, and the ledger helpers. |

## Worked example: a first test with no bespoke setup

Before this crate, a new contract's first test needed a hand-written `setup`
plus `Env::default()` / `mock_all_auths()` / `Address::generate` boilerplate.
Now it is:

```rust
use test_utils::TestEnv;

#[test]
fn first_test() {
    let t = TestEnv::new();           // env + mocked auths + an admin
    let id = t.register(MyContract);  // any contract type
    let client = MyContractClient::new(t.env(), &id);

    // The admin, a fresh account, a token and ledger control are all here:
    let alice = t.account();
    let (token, token_admin) = t.token();
    test_utils::mint(&token_admin, &alice, 1_000);
    t.advance_time(3_600);

    assert_eq!(token.balance(&alice), 1_000);
}
```

Or, if you only want the environment:

```rust
use test_utils::{account, create_token, mint, register_contract, test_env};

let env = test_env();
let admin = account(&env);
let (token, token_admin) = create_token(&env, &admin);
let alice = account(&env);
mint(&token_admin, &alice, 1_000);
```

## Migrated modules

The following test modules now use `test_utils` instead of their own copies of
the helpers:

- `contracts/feature_flags/src/test.rs`
- `contracts/protocol_registry/src/test.rs`
- `contracts/pricing_adapter/src/test.rs`
- `contracts/lumen_token/src/test.rs`
- `contracts/matching_pool/src/tests/matching_math.rs`

Each migration is behaviour-preserving: the shared helpers perform exactly the
same operations as the code they replace, so the assertions and coverage are
unchanged.

## Workspace test runtime

The workspace runtime is unchanged by this refactor: the shared helpers perform
exactly the same host calls the per-crate copies did, so `cargo test --workspace`
executes the same assertions either way. Warm-build wall-clock timings before
and after the migration are reported in the pull request. The payoff is
source-level — roughly 120 lines of duplicated scaffolding removed, and no
`setup` to write before a new crate's first test can run.
