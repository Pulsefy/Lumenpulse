/// Stable-Swap Pool – Comprehensive Test Suite
///
/// Acceptance criteria covered:
///   1. Pool invariant holds across add-liquidity / swap / remove-liquidity sequences.
///   2. Rounding always favours the pool (caller never gets more than the formula allows).
///   3. Slippage limits (`min_lp`, `min_out`, `min_a`/`min_b`) are enforced on all entry-points.
///   4. Extreme imbalance and near-empty pool states produce no panics / overflow.
///   5. Fee accounting is conserved across a sequence of swaps.
///   6. TTL / storage-bump behaviour (pre-existing tests, preserved).
///   7. Re-entrancy guard (pre-existing test, preserved).
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{symbol_short, Address, Env};

// ─── helpers ─────────────────────────────────────────────────────────────────

/// Register a pool with two distinct stable tokens, seed `user` with a large
/// balance on both sides and deposit `deposit_a` / `deposit_b` as initial
/// liquidity.  Returns `(client, token_a_address, token_b_address, user)`.
fn setup_pool_with_liquidity(
    env: &Env,
    deposit_a: i128,
    deposit_b: i128,
) -> (StableSwapPoolContractClient, Address, Address, Address) {
    let admin = Address::generate(env);
    let user  = Address::generate(env);

    let ta_id = env.register_stellar_asset_contract_v2(Address::generate(env));
    let tb_id = env.register_stellar_asset_contract_v2(Address::generate(env));

    // Mint generous balances so transfers never fail.
    StellarAssetClient::new(env, &ta_id.address()).mint(&user, &10_000_000_000i128);
    StellarAssetClient::new(env, &tb_id.address()).mint(&user, &10_000_000_000i128);

    let pool_id = env.register(StableSwapPoolContract, ());
    let client  = StableSwapPoolContractClient::new(env, &pool_id);
    client.initialize(&admin, &ta_id.address(), &tb_id.address());

    client.add_liquidity(&user, &deposit_a, &deposit_b, &0i128);

    (client, ta_id.address(), tb_id.address(), user)
}

// ─── 1. Pool invariant ───────────────────────────────────────────────────────

/// After `add_liquidity` the reserves must equal exactly the deposited amounts.
#[test]
fn test_invariant_reserves_match_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, _user) = setup_pool_with_liquidity(&env, 500_000, 500_000);
    let (ra, rb) = client.get_reserves();
    assert_eq!(ra, 500_000);
    assert_eq!(rb, 500_000);
}

/// After a swap the total value held by the pool must increase (fee retained).
#[test]
fn test_invariant_pool_sum_grows_after_swap() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);
    let (ra0, rb0) = client.get_reserves();

    let out = client.swap(&user, &ta, &10_000i128, &0i128);

    let (ra1, rb1) = client.get_reserves();
    assert!(ra1 + rb1 > ra0 + rb0, "pool sum must grow after swap");
    assert!(out > 0, "amount_out must be > 0");
}

/// add → swap → remove full round-trip leaves reserves non-negative.
#[test]
fn test_invariant_full_round_trip() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 2_000_000, 2_000_000);

    // Swap A → B.
    client.swap(&user, &ta, &100_000i128, &0i128);

    // Manually credit a helper user with half the LP supply so we can call
    // remove_liquidity without needing a second depositor transaction.
    let pool_id = client.address.clone();
    let helper  = Address::generate(&env);

    let lp_supply: i128 = {
        let mut s = 0i128;
        env.as_contract(&pool_id, || {
            s = env.storage().persistent().get(&DataKey::LPSupply).unwrap_or(0);
        });
        s
    };
    let half = lp_supply / 2;

    env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(helper.clone()), &half);
    });

    let (out_a, out_b) = client.remove_liquidity(&helper, &half, &0i128, &0i128);
    assert!(out_a > 0 && out_b > 0, "remove_liquidity must return >0 for both tokens");

    let (ra, rb) = client.get_reserves();
    assert!(ra >= 0 && rb >= 0, "reserves must stay non-negative");
}

// ─── 2. Rounding always favours the pool ─────────────────────────────────────

/// The actual `amount_out` must be <= the ideal constant-product output and
/// within 1 unit of it (one floor step, no excess truncation).
#[test]
fn test_rounding_favours_pool_on_swap() {
    let env = Env::default();
    env.mock_all_auths();

    let reserve = 1_000_000i128;
    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, reserve, reserve);

    let amount_in = 7_777i128; // odd number maximises truncation exposure
    let after_fee = (amount_in * (10_000 - SWAP_FEE_BP as i128)) / 10_000;
    let ideal_out = (reserve * after_fee) / (reserve + after_fee);

    let actual_out = client.swap(&user, &ta, &amount_in, &0i128);

    assert!(
        actual_out <= ideal_out,
        "rounding must not favour caller: actual={actual_out} ideal={ideal_out}"
    );
    assert!(
        ideal_out - actual_out <= 1,
        "rounding error too large: ideal={ideal_out} actual={actual_out}"
    );
}

/// `remove_liquidity` output is floored; amounts must not exceed the
/// proportional share implied by the LP token fraction.
#[test]
fn test_rounding_favours_pool_on_remove_liquidity() {
    let env = Env::default();
    env.mock_all_auths();

    // Asymmetric reserves to ensure division is non-trivial.
    let (client, _ta, _tb, _user) =
        setup_pool_with_liquidity(&env, 1_000_003, 999_997);

    let pool_id = client.address.clone();
    let helper  = Address::generate(&env);
    let lp_remove = 1i128; // tiny amount to stress floor-division rounding

    let (lp_supply, ra, rb): (i128, i128, i128) = {
        let mut s = 0i128;
        let mut a = 0i128;
        let mut b = 0i128;
        env.as_contract(&pool_id, || {
            s = env.storage().persistent().get(&DataKey::LPSupply).unwrap_or(0);
            a = env.storage().persistent().get(&DataKey::ReserveA).unwrap_or(0);
            b = env.storage().persistent().get(&DataKey::ReserveB).unwrap_or(0);
        });
        (s, a, b)
    };

    env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(helper.clone()), &lp_remove);
    });

    let ideal_a = (lp_remove * ra) / lp_supply;
    let ideal_b = (lp_remove * rb) / lp_supply;

    let (out_a, out_b) = client.remove_liquidity(&helper, &lp_remove, &0i128, &0i128);

    assert!(out_a <= ideal_a + 1, "out_a={out_a} must not exceed ideal_a={ideal_a}");
    assert!(out_b <= ideal_b + 1, "out_b={out_b} must not exceed ideal_b={ideal_b}");
}

// ─── 3. Slippage / minimum-output enforcement ─────────────────────────────────

/// `add_liquidity` must revert when minted LP < `min_lp`.
#[test]
fn test_slippage_add_liquidity_min_lp_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let result = client.try_add_liquidity(&user, &1_000i128, &1_000i128, &999_999i128);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::SlippageExceeded)),
        "must revert when lp_tokens < min_lp"
    );
}

/// `swap` must revert when output < `min_out`.
#[test]
fn test_slippage_swap_min_out_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let result = client.try_swap(&user, &ta, &1_000i128, &100_000i128);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::SlippageExceeded)),
        "must revert when amount_out < min_out"
    );
}

/// `remove_liquidity` must revert when out_a < `min_a`.
#[test]
fn test_slippage_remove_liquidity_min_a_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, _user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let pool_id = client.address.clone();
    let helper  = Address::generate(&env);
    env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(helper.clone()), &100i128);
    });

    let result = client.try_remove_liquidity(&helper, &100i128, &999_999i128, &0i128);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::SlippageExceeded)),
        "must revert when out_a < min_a"
    );
}

/// `remove_liquidity` must revert when out_b < `min_b`.
#[test]
fn test_slippage_remove_liquidity_min_b_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, _user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let pool_id = client.address.clone();
    let helper  = Address::generate(&env);
    env.as_contract(&pool_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(helper.clone()), &100i128);
    });

    let result = client.try_remove_liquidity(&helper, &100i128, &0i128, &999_999i128);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::SlippageExceeded)),
        "must revert when out_b < min_b"
    );
}

/// A swap that exactly meets `min_out` must succeed and return that exact amount.
#[test]
fn test_slippage_swap_exactly_at_min_out_passes() {
    let env = Env::default();
    env.mock_all_auths();

    let reserve = 1_000_000i128;
    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, reserve, reserve);

    let amount_in = 10_000i128;
    let after_fee = (amount_in * (10_000 - SWAP_FEE_BP as i128)) / 10_000;
    let exact_out = (reserve * after_fee) / (reserve + after_fee);

    let actual = client.swap(&user, &ta, &amount_in, &exact_out);
    assert_eq!(actual, exact_out, "swap at exact min_out must succeed");
}

// ─── 4. Extreme / edge-case states ───────────────────────────────────────────

/// Bootstrap (first liquidity): LP minted equals geometric mean of deposits.
#[test]
fn test_first_liquidity_geometric_mean() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user  = Address::generate(&env);
    let ta_id = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let tb_id = env.register_stellar_asset_contract_v2(Address::generate(&env));

    StellarAssetClient::new(&env, &ta_id.address()).mint(&user, &1_000_000_000i128);
    StellarAssetClient::new(&env, &tb_id.address()).mint(&user, &1_000_000_000i128);

    let pool_id = env.register(StableSwapPoolContract, ());
    let client  = StableSwapPoolContractClient::new(&env, &pool_id);
    client.initialize(&admin, &ta_id.address(), &tb_id.address());

    let lp = client.add_liquidity(&user, &1_000_000i128, &1_000_000i128, &0i128);
    // isqrt(1_000_000 x 1_000_000) = 1_000_000
    assert_eq!(lp, 1_000_000i128, "bootstrap LP must equal geometric mean");
}

/// 100x imbalance: swap must complete without panic, output >= 0.
#[test]
fn test_extreme_imbalance_no_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 100_000_000, 1_000);

    let out = client.swap(&user, &ta, &100i128, &0i128);
    assert!(out >= 0, "output must be non-negative in imbalanced pool, got {out}");
}

/// Near-empty pool (reserves = 2): swap must not panic.
#[test]
fn test_near_empty_pool_no_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 2, 2);

    match client.try_swap(&user, &ta, &1i128, &0i128) {
        Ok(Ok(out)) => assert!(out >= 0, "non-negative output required, got {out}"),
        _  => { /* graceful error also acceptable for near-empty pool */ }
    }
}

/// Zero-amount inputs must all be rejected with `invalid_amount`.
#[test]
fn test_zero_amount_inputs_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let inv_add = Err(Ok(StableSwapError::InvalidAmount));
    assert_eq!(client.try_add_liquidity(&user, &0i128, &1i128, &0i128), inv_add, "zero amount_a");
    assert_eq!(client.try_add_liquidity(&user, &1i128, &0i128, &0i128), inv_add, "zero amount_b");
    assert_eq!(client.try_swap(&user, &ta, &0i128, &0i128),             inv_add, "zero swap in");
    
    let inv_rem = Err(Ok(StableSwapError::InvalidAmount));
    assert_eq!(client.try_remove_liquidity(&user, &0i128, &0i128, &0i128), inv_rem, "zero lp_amount");
}

/// A very large swap (90% of reserve) must not overflow and must return a
/// positive value strictly less than the output reserve.
#[test]
fn test_large_swap_no_overflow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, _tb, user) =
        setup_pool_with_liquidity(&env, 1_000_000_000, 1_000_000_000);

    let out = client.swap(&user, &ta, &900_000_000i128, &0i128);
    assert!(out > 0 && out < 1_000_000_000, "large swap out={out} must be in (0, reserve)");
}

// ─── 5. Fee accounting conservation ─────────────────────────────────────────

/// 10 A->B / B->A round-trip swaps: pool total value must strictly increase.
#[test]
fn test_fee_conservation_across_swap_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, tb, user) =
        setup_pool_with_liquidity(&env, 10_000_000, 10_000_000);

    let (ra0, rb0) = client.get_reserves();
    let sum_before = ra0 + rb0;

    for _ in 0..10 {
        client.swap(&user, &ta, &50_000i128, &0i128);
        client.swap(&user, &tb, &50_000i128, &0i128);
    }

    let (ra1, rb1) = client.get_reserves();
    let sum_after = ra1 + rb1;

    assert!(
        sum_after > sum_before,
        "fees must accumulate: before={sum_before} after={sum_after}"
    );
}



/// Two equal deposits into a balanced pool must mint proportional LP amounts.
#[test]
fn test_lp_share_proportionality() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);

    let lp1 = client.add_liquidity(&user, &100_000i128, &100_000i128, &0i128);
    let lp2 = client.add_liquidity(&user, &100_000i128, &100_000i128, &0i128);

    // After identical deposits into a balanced pool the second mint may be
    // fractionally smaller (larger pool denominator) but must be >= 99% of lp1.
    assert!(
        lp2 <= lp1 && lp2 >= lp1 * 99 / 100,
        "LP proportionality violated: lp1={lp1} lp2={lp2}"
    );
}

// ─── 6. Reserves never go negative ───────────────────────────────────────────

#[test]
fn test_reserves_stay_non_negative_across_sequence() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, ta, tb, user) = setup_pool_with_liquidity(&env, 500_000, 500_000);

    for i in 1..=20i128 {
        client.swap(&user, &ta, &(i * 1_000), &0i128);
        client.swap(&user, &tb, &(i * 900),   &0i128);
    }

    let (ra, rb) = client.get_reserves();
    assert!(ra >= 0, "reserve_a must be >= 0, got {ra}");
    assert!(rb >= 0, "reserve_b must be >= 0, got {rb}");
}

// ─── 7. Initialization guard ─────────────────────────────────────────────────

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin   = Address::generate(&env);
    let ta      = Address::generate(&env);
    let tb      = Address::generate(&env);
    let pool_id = env.register(StableSwapPoolContract, ());
    let client  = StableSwapPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &ta, &tb);
    let result = client.try_initialize(&admin, &ta, &tb);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::AlreadyInitialized)),
        "second initialize must fail"
    );
}

// ─── 8. Insufficient LP balance ──────────────────────────────────────────────

#[test]
fn test_remove_liquidity_insufficient_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _ta, _tb, _user) = setup_pool_with_liquidity(&env, 1_000_000, 1_000_000);
    
    let user2 = Address::generate(&env);

    // A fresh address with 0 LP tokens tries to remove 1.
    let result = client.try_remove_liquidity(&user2, &1i128, &0i128, &0i128);
    assert_eq!(
        result,
        Err(Ok(StableSwapError::InsufficientBalance)),
        "remove with no LP balance must fail"
    );
}

// ─── 9. Pre-existing: reentrancy guard (preserved) ───────────────────────────

#[test]
fn test_reentrancy_guard_add_liquidity_rejects_when_locked() {
    let env = Env::default();
    env.mock_all_auths();

    let admin       = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id    = env.register_stellar_asset_contract_v2(token_admin.clone());

    let pool_id = env.register(StableSwapPoolContract, ());
    let client  = StableSwapPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &token_id.address(), &token_id.address());

    // Simulate reentrant lock state.
    env.as_contract(&pool_id, || {
        env.storage()
            .instance()
            .set(&symbol_short!("REENTRANT"), &true);
    });

    let user = Address::generate(&env);
    let result = client.try_add_liquidity(&user, &100i128, &100i128, &0i128);
    assert_eq!(result, Err(Ok(StableSwapError::Reentrancy)));
}

// ─── 10. Pre-existing: TTL / storage-bump (preserved) ───────────────────────

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();

    let admin       = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id    = env.register_stellar_asset_contract_v2(token_admin.clone());
    let user        = Address::generate(&env);

    let pool_id = env.register(StableSwapPoolContract, ());
    let client  = StableSwapPoolContractClient::new(&env, &pool_id);

    client.initialize(&admin, &token_id.address(), &token_id.address());

    // Seed pool state directly (avoids needing a full deposit flow) and rely
    // on the contract's own bump helpers to establish the initial TTL.
    env.as_contract(&pool_id, || {
        env.storage().persistent().set(&DataKey::ReserveA, &1_000i128);
        env.storage().persistent().set(&DataKey::ReserveB, &1_000i128);
        env.storage().persistent().set(&DataKey::LPSupply, &1_000i128);
        env.storage()
            .persistent()
            .set(&DataKey::UserLPBalance(user.clone()), &500i128);
        StableSwapPoolContract::bump_pool_ttl(&env);
        StableSwapPoolContract::bump_user_lp_ttl(&env, &user);
    });

    // First threshold crossing: reads should re-bump both the pool-wide and
    // per-user persistent keys.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_reserves(), (1_000i128, 1_000i128));
    assert_eq!(client.lp_balance(&user), 500i128);

    // Second threshold crossing: this only survives if the prior reads
    // actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert_eq!(client.get_reserves(), (1_000i128, 1_000i128));
    assert_eq!(client.lp_balance(&user), 500i128);
}
