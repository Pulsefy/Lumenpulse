// Failure injection at matching_pool's token call sites (#1622).
//
// A trapped transfer must revert the whole invocation: pool accounting and
// round status stay untouched and the call can simply be retried. See
// docs/CROSS_CONTRACT_FAILURE_HANDLING.md for the call-site inventory.

use crate::{MatchingPoolContract, MatchingPoolContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, vec, Address, Env, Symbol};
use test_utils::{set_time, FaultyToken, FaultyTokenClient};

const POOL: i128 = 1_000_000;

struct Fixture<'a> {
    env: Env,
    pool: MatchingPoolContractClient<'a>,
    token: FaultyTokenClient<'a>,
    admin: Address,
    funder: Address,
    round_id: u64,
}

fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    set_time(&env, 1_000);

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let token = FaultyTokenClient::new(&env, &env.register(FaultyToken, ()));
    token.mint(&funder, &(POOL * 2));

    let pool = MatchingPoolContractClient::new(&env, &env.register(MatchingPoolContract, ()));
    pool.initialize(&admin);
    let round_id = pool.create_round(
        &admin,
        &symbol_short!("XFail"),
        &token.address,
        &1_000,
        &2_000,
    );

    Fixture {
        env,
        pool,
        token,
        admin,
        funder,
        round_id,
    }
}

#[test]
fn fund_pool_token_failure_leaves_pool_unchanged() {
    let f = setup();
    f.token.fail_transfers_to(&Some(f.pool.address.clone()));
    assert!(f.pool.try_fund_pool(&f.funder, &f.round_id, &POOL).is_err());
    assert_eq!(f.pool.get_pool_balance(&f.round_id), 0);
    assert_eq!(f.pool.get_round(&f.round_id).total_pool, 0);
    assert_eq!(f.token.balance(&f.funder), POOL * 2);

    f.token.fail_transfers_to(&None);
    f.pool.fund_pool(&f.funder, &f.round_id, &POOL);
    assert_eq!(f.pool.get_pool_balance(&f.round_id), POOL);
    assert_eq!(f.token.balance(&f.pool.address), POOL);
}

#[test]
fn distribution_failure_mid_loop_reverts_every_payout() {
    let f = setup();
    f.pool.fund_pool(&f.funder, &f.round_id, &POOL);
    let owners = vec![
        &f.env,
        Address::generate(&f.env),
        Address::generate(&f.env),
        Address::generate(&f.env),
    ];
    for pid in 0..3u64 {
        f.pool.approve_project(&f.admin, &f.round_id, &pid);
        f.pool.record_contribution(
            &f.round_id,
            &pid,
            &Address::generate(&f.env),
            &(10_000 * (pid as i128 + 1)),
        );
    }
    set_time(&f.env, 2_001);
    f.pool.finalize_round(&f.admin, &f.round_id);

    // The first payout succeeds, the second traps.
    f.token.fail_transfers_to(&Some(owners.get(1).unwrap()));
    assert!(f
        .pool
        .try_distribute_matching_funds(&f.admin, &f.round_id, &owners)
        .is_err());
    assert_eq!(f.pool.get_pool_balance(&f.round_id), POOL);
    assert_eq!(f.token.balance(&f.pool.address), POOL);
    assert!(!f.pool.get_round(&f.round_id).is_distributed);
    assert_ne!(
        f.pool.get_round_status(&f.round_id),
        Symbol::new(&f.env, "DISTRIBUTED")
    );
    for owner in owners.iter() {
        assert_eq!(f.token.balance(&owner), 0);
    }

    // Recovery: clear the fault and retry; the pool is paid out exactly once.
    f.token.fail_transfers_to(&None);
    let distributed = f
        .pool
        .distribute_matching_funds(&f.admin, &f.round_id, &owners);
    assert_eq!(distributed, POOL);
    let paid: i128 = owners.iter().map(|o| f.token.balance(&o)).sum();
    assert_eq!(paid, POOL);
    assert_eq!(f.token.balance(&f.pool.address), 0);
    assert!(f
        .pool
        .try_distribute_matching_funds(&f.admin, &f.round_id, &owners)
        .is_err());
}
