//! # `test_utils` — shared Soroban test harness
//!
//! Every contract in this workspace used to re-implement the same test
//! scaffolding: build an [`Env`], mock auths, generate an admin address,
//! register a Stellar Asset Contract, mint to a user, and nudge the ledger
//! forward. That duplication was the main cost of writing a first test for a
//! new crate, so this crate centralises it.
//!
//! The whole crate is a dev-dependency: it is never linked into a deployed
//! contract.
//!
//! ## Worked example
//!
//! A brand-new crate can go from `cargo new` to a passing test with no
//! bespoke setup:
//!
//! ```rust
//! use soroban_sdk::Env;
//! use test_utils::{account, create_token, mint, TestEnv};
//!
//! // 1. The one-liner: an `Env` with auths mocked.
//! let env = test_utils::test_env();
//!
//! // 2. Or the structured harness when you want an admin + token in one go.
//! let t = TestEnv::new();
//! let admin = t.admin().clone();
//! let (token, token_admin) = t.token();       // Stellar Asset Contract
//!
//! // 3. Fund a fresh account and check the balance.
//! let alice = t.account();
//! mint(&token_admin, &alice, 1_000);
//! assert_eq!(token.balance(&alice), 1_000);
//!
//! // 4. Register your contract and drive it. `t.register` forwards to
//! //    `Env::register`, so any contract type works.
//! //    let id = t.register(MyContract, ());
//! //    let client = MyContractClient::new(t.env(), &id);
//!
//! // 5. Time travel instead of hand-rolling `ledger().with_mut(...)`.
//! let start = t.env().ledger().timestamp();
//! t.advance_time(3_600);
//! assert_eq!(t.env().ledger().timestamp(), start + 3_600);
//! ```
//!
//! The example above is illustrative rather than compiled (`doctest = false`),
//! because this crate cannot depend on the contracts that depend on it. The
//! same sequence is exercised for real by the migrated test suites, e.g.
//! `contracts/feature_flags/src/test.rs` and
//! `contracts/matching_pool/src/tests/matching_math.rs`.

mod faulty_token;
mod ledger;
mod token;

pub use faulty_token::{FaultyToken, FaultyTokenClient};
pub use ledger::{advance_sequence, advance_time, set_sequence, set_time, timestamp};
pub use token::{create_token, mint};

use soroban_sdk::{
    testutils::{Address as _, Register},
    token::{StellarAssetClient, TokenClient},
    Address, ConstructorArgs, Env,
};

/// A fresh [`Env`] with every authorization mocked.
///
/// Equivalent to `Env::default()` followed by `Env::mock_all_auths()`, which is
/// the preamble of almost every test in the workspace.
pub fn test_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

/// Generate a fresh, random account address bound to `env`.
pub fn account(env: &Env) -> Address {
    Address::generate(env)
}

/// Register `contract` with the given constructor `args` and return its address.
///
/// Forwards to [`Env::register`]; pass `()` for contracts without a
/// constructor, or the generated `ContractArgs` type for those with one.
pub fn register<C, A>(env: &Env, contract: C, args: A) -> Address
where
    C: Register,
    A: ConstructorArgs,
{
    env.register(contract, args)
}

/// Convenience wrapper around [`register`] for the common no-constructor case.
pub fn register_contract<C>(env: &Env, contract: C) -> Address
where
    C: Register,
{
    env.register(contract, ())
}

/// A pre-wired test harness: an [`Env`] with mocked auths plus a generated
/// admin account.
///
/// The `TestEnv` owns the `Env`, so the clients and tokens returned by its
/// methods borrow from it and stay alive for the whole test body. That makes a
/// first test in a new crate a three-liner instead of a hand-written `setup`.
pub struct TestEnv {
    env: Env,
    admin: Address,
}

impl TestEnv {
    /// Build a new harness with mocked auths and a fresh admin account.
    pub fn new() -> Self {
        let env = test_env();
        let admin = account(&env);
        Self { env, admin }
    }

    /// The underlying [`Env`].
    pub fn env(&self) -> &Env {
        &self.env
    }

    /// The generated admin account.
    pub fn admin(&self) -> &Address {
        &self.admin
    }

    /// Generate an additional random account.
    pub fn account(&self) -> Address {
        account(&self.env)
    }

    /// Register a contract with no constructor arguments.
    pub fn register<C>(&self, contract: C) -> Address
    where
        C: Register,
    {
        register_contract(&self.env, contract)
    }

    /// Register a Stellar Asset Contract administered by the harness admin and
    /// return its read and mint clients.
    pub fn token(&self) -> (TokenClient<'_>, StellarAssetClient<'_>) {
        create_token(&self.env, &self.admin)
    }

    /// Advance the ledger timestamp by `seconds`.
    pub fn advance_time(&self, seconds: u64) {
        advance_time(&self.env, seconds);
    }

    /// Move the ledger timestamp to `at`.
    pub fn set_time(&self, at: u64) {
        set_time(&self.env, at);
    }

    /// Advance the ledger sequence number by `ledgers`.
    pub fn advance_sequence(&self, ledgers: u32) {
        advance_sequence(&self.env, ledgers);
    }
}

impl Default for TestEnv {
    fn default() -> Self {
        Self::new()
    }
}
