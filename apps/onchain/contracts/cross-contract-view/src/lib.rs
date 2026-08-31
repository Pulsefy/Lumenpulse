//! Cross-contract view helper library for consistent read patterns.
//!
//! This library provides standardized patterns for cross-contract reads
//! to reduce duplicated logic and ensure consistent error handling across
//! modules.
//!
//! # Features
//!
//! - **Safe view calls**: Wrappers that handle common read patterns with proper error handling
//! - **Token operations**: Helpers for balance checks and allowance queries
//! - **Admin validation**: Standardized admin verification patterns
//! - **State queries**: Safe contract state reads with TTL management

#![no_std]

pub mod admin_helpers;
mod errors;
pub mod safe_view;
pub mod token_helpers;

pub use admin_helpers::{get_admin, require_admin};
pub use errors::ViewError;
pub use safe_view::{has_state, read_state, read_state_with_default};
pub use token_helpers::{allowance, balance, token_info};
