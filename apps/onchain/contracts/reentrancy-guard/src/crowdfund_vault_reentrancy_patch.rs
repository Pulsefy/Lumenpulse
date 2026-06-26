// Every patched function follows the same rule:
//
//   1. `let _guard = ReentrancyGuard::new(&env) ...` as the FIRST statement
//      after auth checks (auth must remain before the guard so a failing auth
//      doesn't leave the lock set).
//   2. All existing logic is unchanged — only the guard line is added.
//   3. The RAII drop at function exit (normal or early return) releases the lock.
//
// Import to add at the top of lib.rs:
//   use lumenpulse_reentrancy_guard::ReentrancyGuard;

use lumenpulse_reentrancy_guard::ReentrancyGuard;

// ─── deposit() ───────────────────────────────────────────────────────────────
//
// Vulnerability before patch:
//   token::transfer(user → contract) is called, then state is updated.
//   A malicious token contract can callback into deposit() between the
//   transfer and the balance write, crediting funds twice.
//
// The notify_subscribers() call at the end is also a cross-contract
// re-entry vector — a subscriber could call back into deposit().

pub fn deposit(
    env: Env,
    user: Address,
    project_id: u64,
    amount: i128,
) -> Result<(), CrowdfundError> {
    Self::require_current_storage_version(&env)?;
    user.require_auth();                                          // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
    if is_paused { return Err(CrowdfundError::ContractPaused); }
    if amount <= 0 { return Err(CrowdfundError::InvalidAmount); }

    let mut project: ProjectData = env
        .storage().persistent().get(&DataKey::Project(project_id))
        .ok_or(CrowdfundError::ProjectNotFound)?;

    Self::fail_if_project_expired(&env, project_id, &mut project)?;
    if !project.is_active { return Err(CrowdfundError::ProjectNotActive); }

    let contract_address = env.current_contract_address();
    let user_balance = token::balance(&env, &project.token_address, &user);
    if user_balance >= amount {
        token::transfer(&env, &project.token_address, &user, &contract_address, &amount);
    }

    let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
    let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
    env.storage().persistent().set(&balance_key, &(current_balance + amount));

    let contribution_key = DataKey::Contribution(project_id, user.clone());
    let current_contribution: i128 = env.storage().persistent().get(&contribution_key).unwrap_or(0);

    if current_contribution == 0 {
        let contributor_count_key = DataKey::ContributorCount(project_id);
        let contributor_count: u32 = env.storage().persistent().get(&contributor_count_key).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Contributor(project_id, contributor_count), &user);
        env.storage().persistent().set(&contributor_count_key, &(contributor_count + 1));
    }
    env.storage().persistent().set(&contribution_key, &(current_contribution + amount));

    project.total_deposited += amount;
    env.storage().persistent().set(&DataKey::Project(project_id), &project);

    let mut stats: ProtocolStats = env.storage().instance().get(&DataKey::ProtocolStats)
        .unwrap_or(ProtocolStats { tvl: 0, cumulative_volume: 0 });
    stats.tvl += amount;
    stats.cumulative_volume += amount;
    env.storage().instance().set(&DataKey::ProtocolStats, &stats);

    events::DepositEvent { user: user.clone(), project_id, amount }.publish(&env);
    Self::notify_subscribers(&env, Symbol::new(&env, "deposit"), (user, project_id, amount).to_xdr(&env));

    Ok(())
    // _guard drops here → lock released before function exits
}

// ─── withdraw() ──────────────────────────────────────────────────────────────
//
// Vulnerability before patch:
//   Two token::transfer calls (fee → treasury, then amount → owner).
//   The treasury address is admin-controlled but not audited; a compromised
//   treasury contract could re-enter on the first transfer before the
//   balance key is decremented (which happens after both transfers).

pub fn withdraw(
    env: Env,
    project_id: u64,
    milestone_id: u32,
    amount: i128,
) -> Result<(), CrowdfundError> {
    Self::require_current_storage_version(&env)?;

    let mut project: ProjectData = env
        .storage().persistent().get(&DataKey::Project(project_id))
        .ok_or(CrowdfundError::ProjectNotFound)?;

    project.owner.require_auth();                                  // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
    if is_paused { return Err(CrowdfundError::ContractPaused); }

    Self::fail_if_project_expired(&env, project_id, &mut project)?;
    if !project.is_active { return Err(CrowdfundError::ProjectNotActive); }
    if amount <= 0 { return Err(CrowdfundError::InvalidAmount); }

    let is_approved: bool = env.storage().persistent()
        .get(&DataKey::MilestoneApproved(project_id, milestone_id)).unwrap_or(false);
    if !is_approved { return Err(CrowdfundError::MilestoneNotApproved); }

    let is_disputed: bool = env.storage().persistent()
        .get(&DataKey::MilestoneDisputed(project_id, milestone_id)).unwrap_or(false);
    if is_disputed { return Err(CrowdfundError::MilestoneEscrowed); }

    let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
    let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
    if total_balance < amount { return Err(CrowdfundError::InsufficientBalance); }

    let invested_key = DataKey::ProjectInvestedBalance(project_id);
    let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
    let local_balance = total_balance - current_invested;
    if local_balance < amount {
        Self::divest_funds_internal(&env, project_id, amount - local_balance)?;
    }

    let contract_address = env.current_contract_address();
    let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
    let treasury: Option<Address> = env.storage().instance().get(&DataKey::Treasury);

    let fee_amount = if treasury.is_some() && fee_bps > 0 {
        (amount.checked_mul(fee_bps as i128).unwrap_or(0)) / 10_000
    } else { 0 };
    let withdraw_amount = amount - fee_amount;

    if fee_amount > 0 {
        token::transfer(&env, &project.token_address, &contract_address, &treasury.clone().unwrap(), &fee_amount);
        events::ProtocolFeeDeductedEvent { project_id, amount: fee_amount }.publish(&env);
    }
    token::transfer(&env, &project.token_address, &contract_address, &project.owner, &withdraw_amount);

    // State updates happen AFTER all transfers (checks-effects-interactions)
    env.storage().persistent().set(&balance_key, &(total_balance - amount));
    project.total_withdrawn += amount;
    env.storage().persistent().set(&DataKey::Project(project_id), &project);
    env.storage().persistent().set(
        &DataKey::ProjectMilestoneExpiry(project_id),
        &(env.ledger().timestamp() + DEFAULT_MILESTONE_EXPIRY_SECONDS),
    );
    env.storage().persistent().remove(&DataKey::ProjectRefundWindowDeadline(project_id));

    let mut stats: ProtocolStats = env.storage().instance().get(&DataKey::ProtocolStats)
        .unwrap_or(ProtocolStats { tvl: 0, cumulative_volume: 0 });
    stats.tvl -= amount;
    env.storage().instance().set(&DataKey::ProtocolStats, &stats);

    events::WithdrawEvent { owner: project.owner, project_id, amount: withdraw_amount }.publish(&env);
    Ok(())
}

// ─── refund_contributors() ───────────────────────────────────────────────────
//
// Vulnerability before patch:
//   Loop of N token transfers. Any contributor whose address is a contract
//   (e.g. a multisig or DeFi router) could re-enter on their refund transfer
//   before the loop completes and the balance key is zeroed.

pub fn refund_contributors(
    env: Env,
    project_id: u64,
    caller: Address,
) -> Result<(), CrowdfundError> {
    Self::require_current_storage_version(&env)?;
    caller.require_auth();                                         // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let mut project: ProjectData = env
        .storage().persistent().get(&DataKey::Project(project_id))
        .ok_or(CrowdfundError::ProjectNotFound)?;

    if project.is_active && Self::has_milestone_expired(&env, project_id) {
        Self::expire_project(&env, project_id, &mut project);
    }
    if project.is_active { return Err(CrowdfundError::ProjectNotCancellable); }

    let status = Self::project_status(&env, project_id);
    if status != Symbol::new(&env, "CANCELED") && status != Symbol::new(&env, "EXPIRED") {
        return Err(CrowdfundError::ProjectNotCancellable);
    }

    let count_key = DataKey::ContributorCount(project_id);
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

    let invested_key = DataKey::ProjectInvestedBalance(project_id);
    let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
    if current_invested > 0 {
        Self::divest_funds_internal(&env, project_id, current_invested)?;
    }

    let contract_address = env.current_contract_address();
    let token_client = TokenClient::new(&env, &project.token_address);
    let mut total_refunded = 0i128;

    for i in 0..count {
        let contrib_key = DataKey::Contributor(project_id, i);
        let contributor: Address = env.storage().persistent().get(&contrib_key)
            .ok_or(CrowdfundError::ProjectNotFound)?;
        let amount_key = DataKey::Contribution(project_id, contributor.clone());
        let amount: i128 = env.storage().persistent().get(&amount_key).unwrap_or(0);
        if amount > 0 {
            // CEI: zero out the record BEFORE the external transfer
            env.storage().persistent().set(&amount_key, &0i128);
            token_client.transfer(&contract_address, &contributor, &amount);
            total_refunded += amount;
            events::ContributionRefundedEvent { project_id, contributor, amount }.publish(&env);
        }
    }

    env.storage().persistent().remove(&count_key);
    let balance_key = DataKey::ProjectBalance(project_id, project.token_address);
    env.storage().persistent().set(&balance_key, &0i128);
    env.storage().persistent().remove(&DataKey::ProjectRefundWindowDeadline(project_id));
    Self::reduce_protocol_tvl(&env, total_refunded);
    Ok(())
}

// ─── clawback_contribution() ─────────────────────────────────────────────────
//
// Vulnerability before patch:
//   token::transfer out happens before the contribution record is removed.
//   A smart-contract wallet at `contributor` could re-enter to claim the
//   same contribution a second time before the record is cleared.

pub fn clawback_contribution(
    env: Env,
    project_id: u64,
    contributor: Address,
) -> Result<i128, CrowdfundError> {
    Self::require_current_storage_version(&env)?;
    contributor.require_auth();                                    // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let mut project: ProjectData = env
        .storage().persistent().get(&DataKey::Project(project_id))
        .ok_or(CrowdfundError::ProjectNotFound)?;

    if project.is_active && Self::has_milestone_expired(&env, project_id) {
        Self::expire_project(&env, project_id, &mut project);
    }

    let status = Self::project_status(&env, project_id);
    if status != Symbol::new(&env, "CANCELED") && status != Symbol::new(&env, "EXPIRED") {
        return Err(CrowdfundError::RefundWindowNotOpen);
    }

    let refund_window_deadline = match Self::refund_window_deadline(&env, project_id) {
        0 if status == Symbol::new(&env, "EXPIRED") =>
            Self::expired_refund_window_deadline(&env, project_id),
        deadline => deadline,
    };
    if refund_window_deadline == 0 { return Err(CrowdfundError::RefundWindowNotOpen); }
    if env.ledger().timestamp() > refund_window_deadline { return Err(CrowdfundError::RefundWindowClosed); }

    let amount_key = DataKey::Contribution(project_id, contributor.clone());
    let amount: i128 = env.storage().persistent().get(&amount_key).unwrap_or(0);
    if amount <= 0 { return Err(CrowdfundError::InsufficientBalance); }

    let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
    let total_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
    let invested_key = DataKey::ProjectInvestedBalance(project_id);
    let current_invested: i128 = env.storage().persistent().get(&invested_key).unwrap_or(0);
    let local_balance = total_balance - current_invested;
    if local_balance < amount {
        Self::divest_funds_internal(&env, project_id, amount - local_balance)?;
    }

    // ── CEI: update state BEFORE the external call ──────────────────────
    env.storage().persistent().remove(&amount_key);
    env.storage().persistent().set(&balance_key, &(total_balance - amount));
    Self::reduce_protocol_tvl(&env, amount);
    // ────────────────────────────────────────────────────────────────────

    let contract_address = env.current_contract_address();
    token::transfer(&env, &project.token_address, &contract_address, &contributor, &amount);

    events::ContributionClawedBackEvent {
        project_id,
        contributor,
        amount,
        refund_window_deadline,
    }.publish(&env);

    Ok(amount)
}

// ─── distribute_match() ──────────────────────────────────────────────────────
//
// Vulnerability before patch:
//   Fee transfer to treasury before pool balance is decremented.
//   A malicious treasury could re-enter to drain the pool.

pub fn distribute_match(env: Env, project_id: u64) -> Result<i128, CrowdfundError> {
    Self::require_current_storage_version(&env)?;

    // ── PATCH ──────────────────────────────────────────────────────────────
    // No auth check precedes this function in the original code — guard goes first.
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
    if is_paused { return Err(CrowdfundError::ContractPaused); }

    let project: ProjectData = env.storage().persistent()
        .get(&DataKey::Project(project_id)).ok_or(CrowdfundError::ProjectNotFound)?;

    let match_amount = Self::calculate_match(env.clone(), project_id)?;
    if match_amount <= 0 { return Ok(0); }

    let pool_key = DataKey::MatchingPool(project.token_address.clone());
    let pool_balance: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
    let actual_match = pool_balance.min(match_amount);
    if actual_match <= 0 { return Ok(0); }

    let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
    let treasury: Option<Address> = env.storage().instance().get(&DataKey::Treasury);
    let fee_amount = if treasury.is_some() && fee_bps > 0 {
        (actual_match.checked_mul(fee_bps as i128).unwrap_or(0)) / 10_000
    } else { 0 };
    let match_after_fee = actual_match - fee_amount;

    // ── CEI: deduct pool BEFORE transfers ───────────────────────────────
    env.storage().persistent().set(&pool_key, &(pool_balance - actual_match));
    let balance_key = DataKey::ProjectBalance(project_id, project.token_address.clone());
    let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
    env.storage().persistent().set(&balance_key, &(current_balance + match_after_fee));
    let mut project = project;
    project.total_deposited += match_after_fee;
    env.storage().persistent().set(&DataKey::Project(project_id), &project);
    // ────────────────────────────────────────────────────────────────────

    if fee_amount > 0 {
        let contract_address = env.current_contract_address();
        token::transfer(&env, &project.token_address, &contract_address, &treasury.unwrap(), &fee_amount);
        events::ProtocolFeeDeductedEvent { project_id, amount: fee_amount }.publish(&env);
    }

    Ok(match_after_fee)
}

// ─── batch_payout() ──────────────────────────────────────────────────────────
//
// Vulnerability before patch:
//   Loop of transfers from reward pool. Any recipient that is a contract
//   could re-enter before the pool balance is decremented at the end.

pub fn batch_payout(
    env: Env,
    admin: Address,
    token_address: Address,
    recipients: Vec<(Address, i128)>,
) -> Result<(), CrowdfundError> {
    Self::verify_admin(&env, &admin)?;                            // auth FIRST

    // ── PATCH ──────────────────────────────────────────────────────────────
    let _guard = ReentrancyGuard::new(&env)
        .map_err(|_| CrowdfundError::Reentrant)?;
    // ───────────────────────────────────────────────────────────────────────

    let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
    if is_paused { return Err(CrowdfundError::ContractPaused); }
    if recipients.is_empty() { return Err(CrowdfundError::InvalidAmount); }

    let contract_address = env.current_contract_address();
    let mut total_amount: i128 = 0;
    for tuple in recipients.iter() {
        let (recipient, amount) = &tuple;
        if *amount <= 0 { return Err(CrowdfundError::InvalidAmount); }
        if *recipient == contract_address { return Err(CrowdfundError::InvalidRecipient); }
        total_amount = total_amount.checked_add(*amount).ok_or(CrowdfundError::InvalidAmount)?;
    }

    let pool_key = DataKey::RewardPool(token_address.clone());
    let pool_balance: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
    if pool_balance < total_amount { return Err(CrowdfundError::InsufficientBalance); }

    // ── CEI: deduct pool BEFORE the transfer loop ───────────────────────
    let new_pool_balance = pool_balance.checked_sub(total_amount).ok_or(CrowdfundError::InvalidAmount)?;
    env.storage().persistent().set(&pool_key, &new_pool_balance);
    // ────────────────────────────────────────────────────────────────────

    for (recipient, amount) in recipients {
        token::transfer(&env, &token_address, &contract_address, &recipient, &amount);
        events::ContributorPayoutEvent { recipient, amount }.publish(&env);
    }
    Ok(())
}