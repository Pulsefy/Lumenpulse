#![no_std]

use soroban_sdk::{contracttype, Env};
use lumenpulse_reentrancy_guard::ReentrancyGuard;

// ─── Storage key ─────────────────────────────────────────────────────────────

/// Sentinel key stored in instance storage. Presence = locked.
#[contracttype]
#[derive(Clone)]
pub enum GuardKey {
    Locked,
}

// ─── Error ───────────────────────────────────────────────────────────────────

/// Returned when a reentrant call is detected.
///
/// Callers should map this to their own error enum, e.g.:
/// ```rust
/// GuardError::Reentrant => ContractError::Reentrant
/// ```
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct ReentrantCallError;

// ─── Low-level primitives ────────────────────────────────────────────────────

/// Acquire the guard.
///
/// Writes `Locked = true` into instance storage after verifying the
/// contract is not already locked. Returns `Err(ReentrantCallError)`
/// immediately if a lock is already held — the function must not
/// proceed with any transfer.
///
/// **Must be paired with `release`.** Prefer the RAII wrapper
/// [`ReentrancyGuard`] to ensure release even on early returns.
#[inline]
pub fn acquire(env: &Env) -> Result<(), ReentrantCallError> {
    if env.storage().instance().has(&GuardKey::Locked) {
        return Err(ReentrantCallError);
    }
    env.storage().instance().set(&GuardKey::Locked, &true);
    Ok(())
}

/// Release the guard.
///
/// Removes the `Locked` key from instance storage. Safe to call even if
/// the lock was never acquired (idempotent) — though that should not
/// happen in normal usage.
#[inline]
pub fn release(env: &Env) {
    env.storage().instance().remove(&GuardKey::Locked);
}

/// Return `true` if the contract is currently locked.
///
/// Useful in tests and read-only views.
#[inline]
pub fn is_locked(env: &Env) -> bool {
    env.storage().instance().has(&GuardKey::Locked)
}

// ─── RAII wrapper ─────────────────────────────────────────────────────────────

/// RAII reentrancy guard.
///
/// Acquires the lock on construction and releases it when dropped.
/// This is the preferred usage pattern because it is immune to early
/// returns and `?` propagation — the lock is always released.
///
/// # Example
/// ```rust
/// pub fn deposit(env: Env, user: Address, amount: i128) -> Result<(), Error> {
///     let _guard = ReentrancyGuard::new(&env)
///         .map_err(|_| Error::Reentrant)?;
///
///     // safe to perform transfers here
///     token_client.transfer(&user, &env.current_contract_address(), &amount);
///     // state update
///     env.storage().persistent().set(&balance_key, &new_balance);
///     Ok(())
///     // _guard drops → release() called → lock removed
/// }
/// ```
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Acquire the reentrancy lock.
    ///
    /// Returns `Err(ReentrantCallError)` if the contract is already locked.
    pub fn new(env: &'a Env) -> Result<Self, ReentrantCallError> {
        acquire(env)?;
        Ok(Self { env })
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        release(self.env);
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn acquire_and_release_cycle() {
        let env = Env::default();
        assert!(!is_locked(&env));

        acquire(&env).expect("first acquire should succeed");
        assert!(is_locked(&env));

        release(&env);
        assert!(!is_locked(&env));
    }

    #[test]
    fn double_acquire_returns_error() {
        let env = Env::default();

        acquire(&env).expect("first acquire should succeed");
        let result = acquire(&env);
        assert_eq!(result, Err(ReentrantCallError));

        // Clean up
        release(&env);
    }

    #[test]
    fn release_is_idempotent() {
        let env = Env::default();
        // Releasing without a prior acquire must not panic
        release(&env);
        release(&env);
        assert!(!is_locked(&env));
    }

    #[test]
    fn raii_guard_acquires_and_releases() {
        let env = Env::default();
        {
            let _guard = ReentrancyGuard::new(&env).expect("should acquire");
            assert!(is_locked(&env));
        }
        // Dropped here
        assert!(!is_locked(&env));
    }

    #[test]
    fn raii_guard_prevents_double_acquire() {
        let env = Env::default();
        let _g1 = ReentrancyGuard::new(&env).expect("first acquire");
        let result = ReentrancyGuard::new(&env);
        assert!(result.is_err());
    }

    #[test]
    fn raii_guard_releases_on_early_return() {
        let env = Env::default();

        fn guarded_fn(env: &Env) -> Result<(), ReentrantCallError> {
            let _guard = ReentrancyGuard::new(env)?;
            return Err(ReentrantCallError); // early exit
        }

        // The guard should have released even though we returned early
        let _ = guarded_fn(&env);
        assert!(!is_locked(&env), "lock must be released after early return");

        // And we can re-acquire cleanly
        acquire(&env).expect("re-acquire after early-return drop should succeed");
        release(&env);
    }

    #[test]
    fn sequential_acquires_work_after_each_release() {
        let env = Env::default();
        for _ in 0..5 {
            acquire(&env).expect("acquire in loop");
            assert!(is_locked(&env));
            release(&env);
            assert!(!is_locked(&env));
        }
    }
}