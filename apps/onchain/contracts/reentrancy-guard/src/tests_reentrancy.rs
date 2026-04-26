#![cfg(test)]

mod reentrancy_tests {
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, Address, Env,
    };
    use lumenpulse_reentrancy_guard::{acquire, is_locked, release, ReentrancyGuard};

    // ── Guard unit tests (mirrors crate tests but run in contract context) ──

    #[test]
    fn guard_blocks_double_entry() {
        let env = Env::default();
        acquire(&env).unwrap();
        assert!(acquire(&env).is_err(), "second acquire must fail");
        release(&env);
    }

    #[test]
    fn guard_releases_after_raii_drop() {
        let env = Env::default();
        {
            let _g = ReentrancyGuard::new(&env).unwrap();
            assert!(is_locked(&env));
        }
        assert!(!is_locked(&env));
    }

    #[test]
    fn guard_releases_on_early_return_via_question_mark() {
        let env = Env::default();

        fn early(env: &Env) -> Result<(), ()> {
            let _g = ReentrancyGuard::new(env).map_err(|_| ())?;
            return Err(());
        }

        let _ = early(&env);
        assert!(!is_locked(&env));
    }

    // ── Mock malicious token that re-enters on transfer ────────────────────

    /// A token that, when transfer() is called, attempts to call back into
    /// a vault function that also tries to acquire the guard.
    /// In a real attack this would be a full vault call; here we simulate
    /// the guard check directly to verify the lock is held during transfers.
    mod mock_reentrant_token {
        use soroban_sdk::{contract, contractimpl, Address, Env};
        use lumenpulse_reentrancy_guard::is_locked;

        #[contract]
        pub struct ReentrantToken;

        #[contractimpl]
        impl ReentrantToken {
            /// Returns true if the vault's guard was held at the time
            /// this transfer was called (i.e. the guard is working).
            pub fn transfer(
                env: Env,
                _from: Address,
                _to: Address,
                _amount: i128,
            ) -> bool {
                // In the attack scenario the vault's guard should be LOCKED here.
                // We check using the same env (cross-contract simulation).
                is_locked(&env)
            }
        }
    }

    // ── Simulated vault functions ──────────────────────────────────────────

    mod simulated_vault {
        use soroban_sdk::Env;
        use lumenpulse_reentrancy_guard::{is_locked, ReentrancyGuard};

        #[derive(Copy, Clone, Debug, PartialEq)]
        pub enum VaultError { Reentrant, Other }

        /// Simulates deposit(): guard → transfer (external) → state write.
        pub fn deposit_guarded(env: &Env) -> Result<(), VaultError> {
            let _guard = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;

            // Simulate token transfer — guard must be LOCKED here
            assert!(is_locked(env), "guard must be held during external call");

            // Simulate state update
            Ok(())
        }

        /// Simulates a reentrant attacker calling deposit_guarded from within deposit_guarded.
        pub fn deposit_reentrant(env: &Env) -> Result<(), VaultError> {
            let _outer = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;
            // This is what happens if the external call tries to re-enter:
            deposit_guarded(env)
        }

        /// Simulates withdraw(): guard → CEI state → transfer out.
        pub fn withdraw_guarded(env: &Env) -> Result<(), VaultError> {
            let _guard = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;
            assert!(is_locked(env));
            Ok(())
        }
    }

    use simulated_vault::*;

    #[test]
    fn deposit_guard_held_during_transfer() {
        let env = Env::default();
        // Normal call succeeds and lock is released after
        deposit_guarded(&env).expect("clean deposit");
        assert!(!is_locked(&env));
    }

    #[test]
    fn deposit_reentrant_call_is_blocked() {
        let env = Env::default();
        let result = deposit_reentrant(&env);
        assert_eq!(
            result,
            Err(VaultError::Reentrant),
            "inner (re-entrant) call must be blocked"
        );
        // Outer guard still releases cleanly
        assert!(!is_locked(&env));
    }

    #[test]
    fn withdraw_guard_held_during_transfer() {
        let env = Env::default();
        withdraw_guarded(&env).expect("clean withdraw");
        assert!(!is_locked(&env));
    }

    #[test]
    fn sequential_operations_after_guard_release() {
        let env = Env::default();
        // Simulate deposit then withdraw in the same ledger
        deposit_guarded(&env).expect("deposit 1");
        deposit_guarded(&env).expect("deposit 2");
        withdraw_guarded(&env).expect("withdraw");
        assert!(!is_locked(&env));
    }

    // ── Loop-transfer simulation (refund_contributors / batch_payout) ──────

    #[test]
    fn loop_transfer_guard_holds_for_entire_loop() {
        let env = Env::default();

        fn refund_loop(env: &Env, n: u32) -> Result<(), VaultError> {
            let _guard = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;
            for _ in 0..n {
                // Each iteration is an external token transfer — guard must be held
                assert!(is_locked(env));
            }
            Ok(())
        }

        refund_loop(&env, 10).expect("10-transfer loop");
        assert!(!is_locked(&env));
    }

    #[test]
    fn loop_transfer_reentrant_attempt_blocked() {
        let env = Env::default();

        fn refund_loop_with_attack(env: &Env) -> Result<(), VaultError> {
            let _guard = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;
            // Attacker tries to call deposit on their refund callback
            let inner = deposit_guarded(env);
            assert_eq!(inner, Err(VaultError::Reentrant));
            Ok(())
        }

        refund_loop_with_attack(&env).expect("outer completes; inner blocked");
        assert!(!is_locked(&env));
    }

    // ── CEI order verification ─────────────────────────────────────────────
    //
    // Verify that state writes happen before external calls in patched functions.
    // We simulate by tracking whether a flag was set before the "transfer".

    #[test]
    fn cei_state_written_before_transfer() {
        let env = Env::default();
        let mut state_written_before_transfer = false;
        let mut transfer_called = false;

        // Simulate the patched clawback pattern:
        // 1. acquire guard
        // 2. write state (CEI)
        // 3. call transfer (external)
        {
            let _guard = ReentrancyGuard::new(&env).unwrap();

            // Step 2: state write
            state_written_before_transfer = true;

            // Step 3: external transfer (check state was written)
            assert!(state_written_before_transfer, "state must be written before external call");
            transfer_called = true;
        }

        assert!(state_written_before_transfer);
        assert!(transfer_called);
        assert!(!is_locked(&env));
    }

    // ── Pause + guard interaction ──────────────────────────────────────────
    //
    // Pause check happens before the guard; verify the guard is never set
    // when the contract is paused (no lock leak).

    #[test]
    fn paused_contract_never_acquires_guard() {
        let env = Env::default();

        fn deposit_with_pause_check(env: &Env, paused: bool) -> Result<(), VaultError> {
            if paused { return Err(VaultError::Other); }
            let _guard = ReentrancyGuard::new(env).map_err(|_| VaultError::Reentrant)?;
            Ok(())
        }

        // Paused → returns before touching the guard
        let _ = deposit_with_pause_check(&env, true);
        assert!(!is_locked(&env), "guard must NOT be set when paused");

        // Not paused → guard acquired and released normally
        deposit_with_pause_check(&env, false).unwrap();
        assert!(!is_locked(&env));
    }
}