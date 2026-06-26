use lumenpulse_reentrancy_guard::ReentrancyGuard;

// ─── fund_pool() ─────────────────────────────────────────────────────────────
//
// Vulnerability before patch:
//   token.transfer(funder → contract) is the external call; pool state update
//   comes after. A malicious token contract could re-enter fund_pool() again
//   before the balance is written, causing the pool to record a double-credit.

pub fn fund_pool(
    env: Env,
    funder: Address,
    round_id: u64,
    amount: i128,
) -> Result<(), MatchingPoolError> {
    Self::require_not_paused(&env)?;
    funder.require_auth();                                         // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| MatchingPoolError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    if amount <= 0 { return Err(MatchingPoolError::InvalidAmount); }

    let mut round: RoundData = env.storage().persistent()
        .get(&DataKey::Round(round_id)).ok_or(MatchingPoolError::RoundNotFound)?;
    if round.is_finalized { return Err(MatchingPoolError::RoundAlreadyFinalized); }

    let contract_addr = env.current_contract_address();
    TokenClient::new(&env, &round.token_address).transfer(&funder, &contract_addr, &amount);

    let pool_key = DataKey::RoundPool(round_id);
    let current: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
    env.storage().persistent().set(&pool_key, &(current + amount));
    round.total_pool += amount;
    env.storage().persistent().set(&DataKey::Round(round_id), &round);

    events::PoolFundedEvent { funder, round_id, amount }.publish(&env);
    Ok(())
}

// ─── distribute_matching_funds() ─────────────────────────────────────────────
//
// Vulnerability before patch:
//   N token transfers in a loop to project owners. The pool is zeroed only
//   AFTER all transfers complete. Any project owner that is a contract could
//   re-enter distribute_matching_funds() on their transfer, receiving an
//   additional allocation before `round.is_distributed = true` is written.
//
// Fix applies two layers:
//   1. Reentrancy guard blocks re-entry entirely.
//   2. CEI: `round.is_distributed = true` and `RoundPool → 0` are written
//      BEFORE the transfer loop (was after in the original).

pub fn distribute_matching_funds(
    env: Env,
    admin: Address,
    round_id: u64,
    project_owners: Vec<Address>,
) -> Result<i128, MatchingPoolError> {
    Self::require_admin(&env, &admin)?;                            // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| MatchingPoolError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let mut round: RoundData = env.storage().persistent()
        .get(&DataKey::Round(round_id)).ok_or(MatchingPoolError::RoundNotFound)?;
    if !round.is_finalized { return Err(MatchingPoolError::RoundNotFinalized); }
    if round.is_distributed { return Err(MatchingPoolError::MatchAlreadyDistributed); }

    let count: u32 = env.storage().persistent()
        .get(&DataKey::EligibleProjectCount(round_id)).unwrap_or(0);
    if count == 0 { return Err(MatchingPoolError::NoEligibleProjects); }

    let mut project_ids: Vec<u64> = vec![&env];
    let mut qf_scores: Vec<i128> = vec![&env];
    let mut total_qf: i128 = 0;

    for i in 0..count {
        let pid: u64 = env.storage().persistent()
            .get(&DataKey::EligibleProjectAt(round_id, i)).unwrap_or(u64::MAX);
        if !env.storage().persistent()
            .get::<_, bool>(&DataKey::EligibleProject(round_id, pid)).unwrap_or(false) {
            continue;
        }
        let score = Self::compute_qf_score(&env, round_id, pid);
        project_ids.push_back(pid);
        qf_scores.push_back(score);
        total_qf = total_qf.saturating_add(score);
    }

    if total_qf == 0 { return Ok(0); }

    let pool: i128 = env.storage().persistent()
        .get(&DataKey::RoundPool(round_id)).unwrap_or(0);
    if pool == 0 { return Err(MatchingPoolError::InsufficientPoolBalance); }

    // ── CEI: mark distributed and zero pool BEFORE any external transfers ─
    round.is_distributed = true;
    env.storage().persistent().set(&DataKey::Round(round_id), &round);
    env.storage().persistent().set(&DataKey::RoundStatus(round_id), &Symbol::new(&env, "DISTRIBUTED"));
    env.storage().persistent().set(&DataKey::MatchDistributed(round_id), &true);
    env.storage().persistent().set(&DataKey::RoundPool(round_id), &0i128);
    // ─────────────────────────────────────────────────────────────────────

    let contract_addr = env.current_contract_address();
    let token = TokenClient::new(&env, &round.token_address);
    let n = project_ids.len();
    let mut total_distributed: i128 = 0;
    let mut remainder = pool;

    for idx in 0..n {
        let pid = project_ids.get(idx).unwrap();
        let score = qf_scores.get(idx).unwrap();
        let alloc = if idx == n - 1 {
            remainder
        } else {
            let a = pool.checked_mul(score).unwrap_or(i128::MAX)
                        .checked_div(total_qf).unwrap_or(0);
            remainder -= a;
            a
        };
        if alloc <= 0 { continue; }
        let owner = match project_owners.get(idx) {
            Some(o) => o,
            None => continue,
        };
        token.transfer(&contract_addr, &owner, &alloc);
        total_distributed += alloc;
        events::MatchDistributedEvent { round_id, project_id: pid, match_amount: alloc }.publish(&env);
    }

    events::AllMatchesDistributedEvent { round_id, total_distributed }.publish(&env);
    Ok(total_distributed)
}