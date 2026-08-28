//! Round-lifecycle invariant suite for `crowdfund_vault`.
//!
//! Covers the open → contribute → finalize → refund/close flow for a
//! project (`create_project` → `deposit` → `approve_milestone`/`withdraw`
//! → `cancel_project` → `refund_contributors`/`clawback_contribution`).
//! The invariants asserted here (`INV-1` .. `INV-7`) are the ones
//! documented in `apps/onchain/contracts/ROUND_LIFECYCLE_INVARIANTS.md`,
//! which also explains the shared vocabulary this suite uses with the
//! equivalent `matching_pool` suite
//! (`matching_pool/src/tests/invariants.rs`).
//!
//! `prop4`..`prop12` in `tests::invariants` already cover TVL tracking,
//! admin-only ops, pause behavior, and quadratic matching; this module
//! focuses on the parts of the lifecycle those don't reach: cancellation,
//! refunds, and clawback.

extern crate std;

use crate::errors::CrowdfundError;
use crate::tests::invariants::{deposit_sequence, do_deposit, setup_vault, valid_amount};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, BytesN, Env,
};

const REFUND_WINDOW_SECONDS: u64 = 14 * 24 * 60 * 60;

// ─── open + contribute phase (INV-1, INV-2, INV-5) ───────────────────────────

#[cfg(test)]
mod contribute_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-2: deposits are rejected once a project has been canceled.
        #[test]
        fn deposit_rejected_after_cancel(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            client.cancel_project(&owner, &project_id);

            token_admin.mint(&user, &amount);
            let result = client.try_deposit(&user, &project_id, &amount, &BytesN::from_array(&env, &[76u8; 32]));
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::ProjectNotActive)),
                "INV-2: deposit must be rejected once the project is canceled"
            );

            let _ = admin;
        }

        // INV-5: only the admin or the project owner may cancel.
        #[test]
        fn cancel_rejects_non_owner_non_admin(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, _token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let intruder = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            let result = client.try_cancel_project(&intruder, &project_id);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::Unauthorized)),
                "INV-5: only admin or owner may cancel a project"
            );
        }

        // INV-1/INV-4: a project cannot be canceled twice.
        #[test]
        fn cancel_twice_rejected(_seed in 0u64..u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, _token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            client.cancel_project(&owner, &project_id);
            let result = client.try_cancel_project(&owner, &project_id);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::ProjectNotActive)),
                "INV-1/INV-4: cancel_project must not succeed a second time"
            );
        }
    }
}

// ─── finalize phase (INV-2) ───────────────────────────────────────────────────

#[cfg(test)]
mod finalize_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-2: a canceled project cannot be withdrawn from even with an
        // already-approved milestone.
        #[test]
        fn withdraw_rejected_after_cancel(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.approve_milestone(&admin, &project_id, &0u32);

            client.cancel_project(&owner, &project_id);

            let result = client.try_withdraw(&project_id, &0u32, &1i128);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::ProjectNotActive)),
                "INV-2: withdraw must be rejected once the project is canceled, \
                 even with an approved milestone"
            );
        }
    }
}

// ─── refund phase (INV-1, INV-2, INV-3, INV-4) ───────────────────────────────

#[cfg(test)]
mod refund_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-1: refund_contributors requires the project to be canceled (or
        // expired) first — it cannot run against a still-active project.
        #[test]
        fn refund_rejected_before_cancel(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);

            let result = client.try_refund_contributors(&project_id, &owner);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::ProjectNotCancellable)),
                "INV-1: refund_contributors must require cancellation/expiry first"
            );
        }

        // INV-3: refund_contributors pays back exactly what was deposited and
        // drains the tracked project balance to zero.
        #[test]
        fn refund_pays_back_deposits_exactly(amounts in deposit_sequence()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );

            let mut expected_total: i128 = 0;
            for amount in &amounts {
                do_deposit(&env, &client, &token_admin, &user, project_id, *amount);
                expected_total += amount;
            }

            let balance_before_cancel = client.get_balance(&project_id);
            prop_assert_eq!(
                balance_before_cancel,
                expected_total,
                "sanity check: pre-cancel balance must equal total deposited"
            );

            client.cancel_project(&owner, &project_id);
            let user_balance_before_refund = token_client.balance(&user);

            client.refund_contributors(&project_id, &owner);

            prop_assert_eq!(
                token_client.balance(&user),
                user_balance_before_refund + expected_total,
                "INV-3: refund must return exactly the total amount deposited"
            );
            prop_assert_eq!(
                client.get_balance(&project_id),
                0i128,
                "INV-3: project balance must be fully drained after refund"
            );
        }

        // INV-1/INV-4: refund_contributors cannot pay out a second time.
        #[test]
        fn refund_twice_rejected(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.cancel_project(&owner, &project_id);
            client.refund_contributors(&project_id, &owner);

            let result = client.try_refund_contributors(&project_id, &owner);
            prop_assert!(
                result.is_err(),
                "INV-1/INV-4: refund_contributors must not succeed a second time \
                 (got {:?})",
                result
            );
        }

        // INV-2: clawback is only available once a project is canceled/expired.
        #[test]
        fn clawback_rejected_before_cancel(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);

            let result = client.try_clawback_contribution(&project_id, &user);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::RefundWindowNotOpen)),
                "INV-2: clawback must be rejected before the project is canceled"
            );
        }

        // INV-3: clawback pays a contributor back exactly their own contribution,
        // and INV-4: a second clawback for the same contributor fails.
        #[test]
        fn clawback_pays_exact_amount_once(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.cancel_project(&owner, &project_id);

            let user_balance_before = token_client.balance(&user);
            let clawed_back = client.clawback_contribution(&project_id, &user);

            prop_assert_eq!(
                clawed_back,
                amount,
                "INV-3: clawback must return exactly the contributor's own deposit"
            );
            prop_assert_eq!(
                token_client.balance(&user),
                user_balance_before + amount,
                "INV-3: contributor's token balance must increase by exactly the clawed-back amount"
            );

            let result = client.try_clawback_contribution(&project_id, &user);
            prop_assert!(
                result.is_err(),
                "INV-4: a second clawback for the same contributor must be rejected (got {:?})",
                result
            );
        }

        // INV-2: clawback closes after the refund window elapses.
        #[test]
        fn clawback_rejected_after_window_closes(amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.cancel_project(&owner, &project_id);

            env.ledger()
                .set_timestamp(env.ledger().timestamp() + REFUND_WINDOW_SECONDS + 1);

            let result = client.try_clawback_contribution(&project_id, &user);
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::RefundWindowClosed)),
                "INV-2: clawback must be rejected once the refund window has closed"
            );
        }
    }
}

// ─── close phase (INV-3) ──────────────────────────────────────────────────────

#[cfg(test)]
mod close_phase {
    use super::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // INV-3: once a project is fully refunded, no further deposits are
        // possible — the project stays permanently closed.
        #[test]
        fn closed_project_rejects_further_deposits(amount in valid_amount(), retry_amount in valid_amount()) {
            let env = Env::default();
            env.mock_all_auths();

            let (client, _admin, token_client, token_admin) = setup_vault(&env);
            let owner = Address::generate(&env);
            let user = Address::generate(&env);

            let project_id = client.create_project(
                &owner,
                &symbol_short!("proj"),
                &1_000_000_000_000i128,
                &token_client.address,
            );
            do_deposit(&env, &client, &token_admin, &user, project_id, amount);
            client.cancel_project(&owner, &project_id);
            client.refund_contributors(&project_id, &owner);

            token_admin.mint(&user, &retry_amount);
            let result = client.try_deposit(&user, &project_id, &retry_amount, &BytesN::from_array(&env, &[77u8; 32]));
            prop_assert_eq!(
                result,
                Err(Ok(CrowdfundError::ProjectNotActive)),
                "INV-3: a closed (refunded) project must permanently reject deposits"
            );
        }
    }
}
