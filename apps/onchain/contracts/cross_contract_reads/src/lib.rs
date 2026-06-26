//! # cross_contract_reads
//!
//! Shared helpers for **safe, ergonomic cross-contract view calls** across the
//! Lumenpulse Soroban onchain workspace.
//!
//! ## Why this crate exists
//!
//! Soroban contracts frequently need to read state from other contracts —
//! checking a token balance before a transfer, inspecting a yield-provider
//! position, or querying the treasury's unlock schedule.  Without a shared
//! abstraction, every contract that does this must:
//!
//! 1. Define (or copy-paste) a `#[contractclient]` trait for the remote interface.
//! 2. Construct the client and call the method.
//! 3. Map the SDK error type to its own contract error enum.
//!
//! This crate centralises steps 1–3 so consuming contracts only need to write:
//!
//! ```rust,ignore
//! cross_contract_reads::token::token_balance(&env, &token_addr, &account)
//!     .map_err(|_| MyError::CrossContractFailed)?
//! ```
//!
//! ## Modules
//!
//! | Module | Purpose |
//! |---|---|
//! | [`token`] | SEP-41 token view calls (`balance`, `decimals`, `total_supply`) |
//! | [`yield_provider`] | Yield-provider balance reads |
//! | [`treasury`] | Lumenpulse streaming-treasury view calls |
//! | [`generic`] | Escape hatch for arbitrary view calls via `invoke_view` |
//!
//! ## Error handling
//!
//! All helpers return [`CrossContractError`] on failure.  Callers translate
//! this to their own error type with a single `.map_err`:
//!
//! ```rust,ignore
//! use cross_contract_reads::CrossContractError;
//!
//! fn do_something(env: &Env, token: &Address, user: &Address)
//!     -> Result<(), MyContractError>
//! {
//!     let balance = cross_contract_reads::token::token_balance(env, token, user)
//!         .map_err(|_| MyContractError::CrossContractFailed)?;
//!     // ...
//!     Ok(())
//! }
//! ```
//!
//! ## Adding a new helper
//!
//! 1. Create a new module file in `src/` (e.g. `src/my_protocol.rs`).
//! 2. Define a `#[contractclient]` trait exposing **only view methods**.
//! 3. Write one or more `pub fn` wrappers that return
//!    `Result<T, CrossContractError>`.
//! 4. Declare the module here in `lib.rs` and document it in `README.md`.

#![no_std]

pub mod error;
pub mod generic;
pub mod token;
pub mod treasury;
pub mod yield_provider;

pub use error::CrossContractError;
