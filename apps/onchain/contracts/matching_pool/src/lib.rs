#![no_std]

mod errors;
mod events;
mod math;
mod storage;

use errors::MatchingPoolError;
use math::{sqrt_scaled, unscale};
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec};
use storage::{DataKey, PauseScope, RoundData, LEDGER_BUMP, LEDGER_THRESHOLD};

#[contract]
pub struct MatchingPoolContract;

#[contractimpl]
impl MatchingPoolContract {
    /// Extends the contract's shared instance TTL (covers `Admin`, `Paused`,
    /// every `ScopePaused(*)`, and `NextRoundId` in one call, since instance
    /// storage has a single TTL for the whole tier).
    fn touch_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Extends a persistent key's TTL, but only if the key actually exists —
    /// calling `extend_ttl` on an absent key panics, and many call sites
    /// below read persistent keys that legitimately may not have been
    /// written yet (e.g. `RoundCap` before `set_round_cap` is ever called).
    fn touch_persistent<K: IntoVal<Env, Val>>(env: &Env, key: &K) {
        if env.storage().persistent().has(key) {
            env.storage()
                .persistent()
                .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), MatchingPoolError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(MatchingPoolError::NotInitialized)?;
        if caller != &admin {
            return Err(MatchingPoolError::Unauthorized);
        }
        caller.require_auth();
        Self::touch_instance(env);
        Ok(())
    }

    // ── Granular pause scope guards ──────────────────────────────────────────

    /// Returns `true` when the given scope is paused, `false` otherwise.
    ///
    /// A scope is paused when either:
    ///  1. Its own `ScopePaused(scope)` key is `true`, **or**
    ///  2. The legacy global `Paused` key is `true` (backward-compat).
    fn is_scope_paused(env: &Env, scope: PauseScope) -> bool {
        Self::touch_instance(env);
        let global: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if global {
            return true;
        }
        env.storage()
            .instance()
            .get(&DataKey::ScopePaused(scope))
            .unwrap_or(false)
    }

    /// Guard for operations that write contributions or fund the pool.
    fn require_contribution_not_paused(env: &Env) -> Result<(), MatchingPoolError> {
        if Self::is_scope_paused(env, PauseScope::Contribution) {
            Err(MatchingPoolError::ContributionScopePaused)
        } else {
            Ok(())
        }
    }

    /// Guard for distribute_matching_funds.
    fn require_payout_not_paused(env: &Env) -> Result<(), MatchingPoolError> {
        if Self::is_scope_paused(env, PauseScope::Payout) {
            Err(MatchingPoolError::PayoutScopePaused)
        } else {
            Ok(())
        }
    }

    /// Guard for admin governance operations (round creation, finalization, …).
    fn require_governance_not_paused(env: &Env) -> Result<(), MatchingPoolError> {
        if Self::is_scope_paused(env, PauseScope::Governance) {
            Err(MatchingPoolError::GovernanceScopePaused)
        } else {
            Ok(())
        }
    }

    // Legacy helper kept so old callers still compile; internally it is
    // replaced by the scoped helpers above.
    #[allow(dead_code)]
    fn require_not_paused(env: &Env) -> Result<(), MatchingPoolError> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            Err(MatchingPoolError::ContractPaused)
        } else {
            Ok(())
        }
    }

    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, MatchingPoolError>
    where
        F: FnOnce() -> Result<T, MatchingPoolError>,
    {
        acquire_reentrancy(env).map_err(|_| MatchingPoolError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), MatchingPoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(MatchingPoolError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        // Legacy global-pause starts false.
        env.storage().instance().set(&DataKey::Paused, &false);
        // All granular scopes start unpaused.
        env.storage()
            .instance()
            .set(&DataKey::ScopePaused(PauseScope::Contribution), &false);
        env.storage()
            .instance()
            .set(&DataKey::ScopePaused(PauseScope::Payout), &false);
        env.storage()
            .instance()
            .set(&DataKey::ScopePaused(PauseScope::Governance), &false);
        env.storage().instance().set(&DataKey::NextRoundId, &0u64);
        Self::touch_instance(&env);
        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn create_round(
        env: Env,
        admin: Address,
        name: Symbol,
        token_address: Address,
        start_time: u64,
        end_time: u64,
    ) -> Result<u64, MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        Self::require_governance_not_paused(&env)?;
        if end_time <= start_time {
            return Err(MatchingPoolError::InvalidRoundDates);
        }
        let round_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextRoundId)
            .unwrap_or(0);
        let round = RoundData {
            id: round_id,
            name: name.clone(),
            token_address,
            start_time,
            end_time,
            total_pool: 0,
            is_finalized: false,
            is_distributed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);
        Self::touch_persistent(&env, &DataKey::Round(round_id));
        env.storage()
            .persistent()
            .set(&DataKey::RoundPool(round_id), &0i128);
        Self::touch_persistent(&env, &DataKey::RoundPool(round_id));
        env.storage()
            .persistent()
            .set(&DataKey::EligibleProjectCount(round_id), &0u32);
        Self::touch_persistent(&env, &DataKey::EligibleProjectCount(round_id));
        env.storage()
            .persistent()
            .set(&DataKey::MatchDistributed(round_id), &false);
        Self::touch_persistent(&env, &DataKey::MatchDistributed(round_id));
        env.storage().persistent().set(
            &DataKey::RoundStatus(round_id),
            &Symbol::new(&env, "ACTIVE"),
        );
        Self::touch_persistent(&env, &DataKey::RoundStatus(round_id));
        env.storage()
            .instance()
            .set(&DataKey::NextRoundId, &(round_id + 1));
        events::RoundCreatedEvent {
            admin,
            round_id,
            name,
            start_time,
            end_time,
        }
        .publish(&env);
        Ok(round_id)
    }

    pub fn fund_pool(
        env: Env,
        funder: Address,
        round_id: u64,
        amount: i128,
    ) -> Result<(), MatchingPoolError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_contribution_not_paused(&env)?;
            funder.require_auth();
            if amount <= 0 {
                return Err(MatchingPoolError::InvalidAmount);
            }
            let mut round: RoundData = env
                .storage()
                .persistent()
                .get(&DataKey::Round(round_id))
                .ok_or(MatchingPoolError::RoundNotFound)?;
            Self::touch_persistent(&env, &DataKey::Round(round_id));
            if round.is_finalized {
                return Err(MatchingPoolError::RoundAlreadyFinalized);
            }
            let pool_key = DataKey::RoundPool(round_id);
            let current: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&pool_key, &(current + amount));
            Self::touch_persistent(&env, &pool_key);
            round.total_pool += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Round(round_id), &round);
            Self::touch_persistent(&env, &DataKey::Round(round_id));

            let contract_addr = env.current_contract_address();
            TokenClient::new(&env, &round.token_address).transfer(&funder, &contract_addr, &amount);

            events::PoolFundedEvent {
                funder,
                round_id,
                amount,
            }
            .publish(&env);
            Ok(())
        })
    }

    pub fn approve_project(
        env: Env,
        admin: Address,
        round_id: u64,
        project_id: u64,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        Self::require_governance_not_paused(&env)?;
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(&env, &DataKey::Round(round_id));
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        let eligible_key = DataKey::EligibleProject(round_id, project_id);
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&eligible_key)
            .unwrap_or(false)
        {
            return Err(MatchingPoolError::ProjectAlreadyEligible);
        }
        env.storage().persistent().set(&eligible_key, &true);
        Self::touch_persistent(&env, &eligible_key);
        let count_key = DataKey::EligibleProjectCount(round_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        Self::touch_persistent(&env, &count_key);
        env.storage()
            .persistent()
            .set(&DataKey::EligibleProjectAt(round_id, count), &project_id);
        Self::touch_persistent(&env, &DataKey::EligibleProjectAt(round_id, count));
        env.storage().persistent().set(&count_key, &(count + 1));
        Self::touch_persistent(&env, &count_key);
        env.storage()
            .persistent()
            .set(&DataKey::ProjectContributions(round_id, project_id), &0i128);
        Self::touch_persistent(&env, &DataKey::ProjectContributions(round_id, project_id));
        env.storage().persistent().set(
            &DataKey::ProjectContributorCount(round_id, project_id),
            &0u32,
        );
        Self::touch_persistent(
            &env,
            &DataKey::ProjectContributorCount(round_id, project_id),
        );
        events::ProjectApprovedEvent {
            round_id,
            project_id,
        }
        .publish(&env);
        Ok(())
    }

    pub fn remove_project(
        env: Env,
        admin: Address,
        round_id: u64,
        project_id: u64,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        Self::require_governance_not_paused(&env)?;
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(&env, &DataKey::Round(round_id));
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        let eligible_key = DataKey::EligibleProject(round_id, project_id);
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&eligible_key)
            .unwrap_or(false)
        {
            return Err(MatchingPoolError::ProjectNotEligible);
        }
        env.storage().persistent().set(&eligible_key, &false);
        Self::touch_persistent(&env, &eligible_key);
        events::ProjectRemovedEvent {
            round_id,
            project_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Set (or update) the round-level contribution cap, i.e. the maximum a
    /// single contributor may put into the round in total, summed across
    /// every eligible project (admin only). A cap of 0 means uncapped.
    /// Changing the cap only affects future contributions — it never claws
    /// back or invalidates contributions already recorded.
    pub fn set_round_cap(
        env: Env,
        admin: Address,
        round_id: u64,
        cap: i128,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        Self::require_governance_not_paused(&env)?;
        if cap < 0 {
            return Err(MatchingPoolError::InvalidAmount);
        }
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(&env, &DataKey::Round(round_id));
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::RoundCap(round_id), &cap);
        Self::touch_persistent(&env, &DataKey::RoundCap(round_id));
        events::RoundCapUpdatedEvent {
            admin,
            round_id,
            cap,
        }
        .publish(&env);
        Ok(())
    }

    pub fn record_contribution(
        env: Env,
        round_id: u64,
        project_id: u64,
        contributor: Address,
        amount: i128,
    ) -> Result<(), MatchingPoolError> {
        Self::require_contribution_not_paused(&env)?;
        if amount <= 0 {
            return Err(MatchingPoolError::InvalidAmount);
        }
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(&env, &DataKey::Round(round_id));
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        let now = env.ledger().timestamp();
        if now < round.start_time || now > round.end_time {
            return Err(MatchingPoolError::RoundNotActive);
        }
        let eligible_key = DataKey::EligibleProject(round_id, project_id);
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&eligible_key)
            .unwrap_or(false)
        {
            return Err(MatchingPoolError::ProjectNotEligible);
        }
        Self::touch_persistent(&env, &eligible_key);
        let round_total_key = DataKey::ContributorRoundTotal(round_id, contributor.clone());
        let prior_round_total: i128 = env
            .storage()
            .persistent()
            .get(&round_total_key)
            .unwrap_or(0);
        Self::touch_persistent(&env, &round_total_key);
        let new_round_total = prior_round_total
            .checked_add(amount)
            .ok_or(MatchingPoolError::InvalidAmount)?;
        let cap_key = DataKey::RoundCap(round_id);
        let cap: i128 = env.storage().persistent().get(&cap_key).unwrap_or(0);
        Self::touch_persistent(&env, &cap_key);
        if cap > 0 && new_round_total > cap {
            return Err(MatchingPoolError::ContributionCapExceeded);
        }
        let contrib_key = DataKey::ContributorAmount(round_id, project_id, contributor.clone());
        let prev: i128 = env.storage().persistent().get(&contrib_key).unwrap_or(0);
        if prev == 0 {
            let cnt_key = DataKey::ProjectContributorCount(round_id, project_id);
            let cnt: u32 = env.storage().persistent().get(&cnt_key).unwrap_or(0);
            Self::touch_persistent(&env, &cnt_key);
            let contributor_at_key = DataKey::ProjectContributor(round_id, project_id, cnt);
            env.storage()
                .persistent()
                .set(&contributor_at_key, &contributor);
            Self::touch_persistent(&env, &contributor_at_key);
            env.storage().persistent().set(&cnt_key, &(cnt + 1));
            Self::touch_persistent(&env, &cnt_key);
        }
        env.storage()
            .persistent()
            .set(&contrib_key, &(prev + amount));
        Self::touch_persistent(&env, &contrib_key);
        let total_key = DataKey::ProjectContributions(round_id, project_id);
        let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&total_key, &(total + amount));
        Self::touch_persistent(&env, &total_key);
        env.storage()
            .persistent()
            .set(&round_total_key, &new_round_total);
        Self::touch_persistent(&env, &round_total_key);
        events::ContributionRecordedEvent {
            round_id,
            project_id,
            contributor,
            amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn finalize_round(
        env: Env,
        admin: Address,
        round_id: u64,
    ) -> Result<(), MatchingPoolError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_admin(&env, &admin)?;
            Self::require_governance_not_paused(&env)?;

            let mut round: RoundData = env
                .storage()
                .persistent()
                .get(&DataKey::Round(round_id))
                .ok_or(MatchingPoolError::RoundNotFound)?;
            Self::touch_persistent(&env, &DataKey::Round(round_id));

            if round.is_finalized {
                return Err(MatchingPoolError::RoundAlreadyFinalized);
            }

            let now = env.ledger().timestamp();
            if now <= round.end_time {
                return Err(MatchingPoolError::RoundStillOpen);
            }

            round.is_finalized = true;
            env.storage()
                .persistent()
                .set(&DataKey::Round(round_id), &round);
            Self::touch_persistent(&env, &DataKey::Round(round_id));
            let status_key = DataKey::RoundStatus(round_id);
            env.storage()
                .persistent()
                .set(&status_key, &Symbol::new(&env, "FINALIZED"));
            Self::touch_persistent(&env, &status_key);
            let finalized_at_key = DataKey::FinalizedAt(round_id);
            env.storage().persistent().set(&finalized_at_key, &now);
            Self::touch_persistent(&env, &finalized_at_key);

            events::RoundFinalizedEvent {
                round_id,
                admin,
                finalized_at: now,
            }
            .publish(&env);
            Ok(())
        })
    }

    pub fn distribute_matching_funds(
        env: Env,
        admin: Address,
        round_id: u64,
        project_owners: Vec<Address>,
    ) -> Result<i128, MatchingPoolError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_admin(&env, &admin)?;
            Self::require_payout_not_paused(&env)?;
            let mut round: RoundData = env
                .storage()
                .persistent()
                .get(&DataKey::Round(round_id))
                .ok_or(MatchingPoolError::RoundNotFound)?;
            Self::touch_persistent(&env, &DataKey::Round(round_id));
            if !round.is_finalized {
                return Err(MatchingPoolError::RoundNotFinalized);
            }
            if round.is_distributed {
                return Err(MatchingPoolError::MatchAlreadyDistributed);
            }
            let eligible_count_key = DataKey::EligibleProjectCount(round_id);
            let count: u32 = env
                .storage()
                .persistent()
                .get(&eligible_count_key)
                .unwrap_or(0);
            Self::touch_persistent(&env, &eligible_count_key);
            if count == 0 {
                return Err(MatchingPoolError::NoEligibleProjects);
            }

            let mut project_ids: Vec<u64> = vec![&env];
            let mut qf_scores: Vec<i128> = vec![&env];
            let mut total_qf: i128 = 0;

            for i in 0..count {
                let at_key = DataKey::EligibleProjectAt(round_id, i);
                let pid: u64 = env.storage().persistent().get(&at_key).unwrap_or(u64::MAX);
                Self::touch_persistent(&env, &at_key);
                let eligible_key = DataKey::EligibleProject(round_id, pid);
                if !env
                    .storage()
                    .persistent()
                    .get::<_, bool>(&eligible_key)
                    .unwrap_or(false)
                {
                    continue;
                }
                Self::touch_persistent(&env, &eligible_key);
                let score = Self::compute_qf_score(&env, round_id, pid);
                project_ids.push_back(pid);
                qf_scores.push_back(score);
                total_qf = total_qf.saturating_add(score);
            }

            if total_qf == 0 {
                return Ok(0);
            }

            let pool_key = DataKey::RoundPool(round_id);
            let pool: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
            Self::touch_persistent(&env, &pool_key);
            if pool == 0 {
                return Err(MatchingPoolError::InsufficientPoolBalance);
            }

            let n = project_ids.len();
            let mut remainder = pool;
            let mut distributions: Vec<(u64, Address, i128)> = vec![&env];
            let mut total_distributed: i128 = 0;
            for idx in 0..n {
                let pid = project_ids.get(idx).unwrap();
                let score = qf_scores.get(idx).unwrap();
                let alloc = if idx == n - 1 {
                    remainder
                } else {
                    let a = pool
                        .checked_mul(score)
                        .unwrap_or(i128::MAX)
                        .checked_div(total_qf)
                        .unwrap_or(0);
                    remainder -= a;
                    a
                };
                if alloc <= 0 {
                    continue;
                }
                let owner = match project_owners.get(idx) {
                    Some(o) => o,
                    None => continue,
                };
                distributions.push_back((pid, owner, alloc));
                total_distributed += alloc;
            }

            round.is_distributed = true;
            env.storage()
                .persistent()
                .set(&DataKey::Round(round_id), &round);
            Self::touch_persistent(&env, &DataKey::Round(round_id));
            let status_key = DataKey::RoundStatus(round_id);
            env.storage()
                .persistent()
                .set(&status_key, &Symbol::new(&env, "DISTRIBUTED"));
            Self::touch_persistent(&env, &status_key);
            let match_distributed_key = DataKey::MatchDistributed(round_id);
            env.storage()
                .persistent()
                .set(&match_distributed_key, &true);
            Self::touch_persistent(&env, &match_distributed_key);
            env.storage().persistent().set(&pool_key, &0i128);
            Self::touch_persistent(&env, &pool_key);

            let contract_addr = env.current_contract_address();
            let token = TokenClient::new(&env, &round.token_address);
            for distribution in distributions {
                let project_id = distribution.0;
                let owner = distribution.1;
                let alloc = distribution.2;
                token.transfer(&contract_addr, &owner, &alloc);
                events::MatchDistributedEvent {
                    round_id,
                    project_id,
                    match_amount: alloc,
                }
                .publish(&env);
            }

            events::AllMatchesDistributedEvent {
                round_id,
                total_distributed,
            }
            .publish(&env);
            Ok(total_distributed)
        })
    }

    fn compute_qf_score(env: &Env, round_id: u64, project_id: u64) -> i128 {
        let cnt_key = DataKey::ProjectContributorCount(round_id, project_id);
        let cnt: u32 = env.storage().persistent().get(&cnt_key).unwrap_or(0);
        Self::touch_persistent(env, &cnt_key);
        if cnt == 0 {
            return 0;
        }
        let mut sum_sqrt: i128 = 0;
        for i in 0..cnt {
            let contributor_key = DataKey::ProjectContributor(round_id, project_id, i);
            let contributor: Address = match env.storage().persistent().get(&contributor_key) {
                Some(a) => a,
                None => continue,
            };
            Self::touch_persistent(env, &contributor_key);
            let amount_key = DataKey::ContributorAmount(round_id, project_id, contributor);
            let amount: i128 = env.storage().persistent().get(&amount_key).unwrap_or(0);
            Self::touch_persistent(env, &amount_key);
            if amount > 0 {
                sum_sqrt = sum_sqrt.saturating_add(sqrt_scaled(amount));
            }
        }
        let squared = sum_sqrt.checked_mul(sum_sqrt).unwrap_or(i128::MAX);
        unscale(unscale(squared))
    }

    /// Reads `Round(round_id)`, bumping its TTL, or fails with
    /// `RoundNotFound`. Shared by every read-only query below so a round
    /// stays alive as long as anyone is still querying it.
    fn read_round(env: &Env, round_id: u64) -> Result<RoundData, MatchingPoolError> {
        let key = DataKey::Round(round_id);
        let round = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(env, &key);
        Ok(round)
    }

    pub fn get_round(env: Env, round_id: u64) -> Result<RoundData, MatchingPoolError> {
        Self::read_round(&env, round_id)
    }

    pub fn get_pool_balance(env: Env, round_id: u64) -> Result<i128, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let pool_key = DataKey::RoundPool(round_id);
        let pool = env.storage().persistent().get(&pool_key).unwrap_or(0);
        Self::touch_persistent(&env, &pool_key);
        Ok(pool)
    }

    pub fn get_project_qf_score(
        env: Env,
        round_id: u64,
        project_id: u64,
    ) -> Result<i128, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        Ok(Self::compute_qf_score(&env, round_id, project_id))
    }

    pub fn preview_distribution(env: Env, round_id: u64) -> Result<Vec<i128>, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let count_key = DataKey::EligibleProjectCount(round_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        Self::touch_persistent(&env, &count_key);
        let pool_key = DataKey::RoundPool(round_id);
        let pool: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
        Self::touch_persistent(&env, &pool_key);
        let mut result: Vec<i128> = vec![&env];
        if count == 0 || pool == 0 {
            return Ok(result);
        }
        let mut total_qf: i128 = 0;
        let mut scores: Vec<i128> = vec![&env];
        let mut pids: Vec<i128> = vec![&env];
        for i in 0..count {
            let at_key = DataKey::EligibleProjectAt(round_id, i);
            let pid: u64 = env.storage().persistent().get(&at_key).unwrap_or(u64::MAX);
            let eligible_key = DataKey::EligibleProject(round_id, pid);
            if !env
                .storage()
                .persistent()
                .get::<_, bool>(&eligible_key)
                .unwrap_or(false)
            {
                continue;
            }
            Self::touch_persistent(&env, &at_key);
            Self::touch_persistent(&env, &eligible_key);
            let score = Self::compute_qf_score(&env, round_id, pid);
            pids.push_back(pid as i128);
            scores.push_back(score);
            total_qf = total_qf.saturating_add(score);
        }
        if total_qf == 0 {
            return Ok(result);
        }
        let n = pids.len();
        let mut remainder = pool;
        for idx in 0..n {
            let pid = pids.get(idx).unwrap();
            let score = scores.get(idx).unwrap();
            let alloc = if idx == n - 1 {
                remainder
            } else {
                let a = pool
                    .checked_mul(score)
                    .unwrap_or(i128::MAX)
                    .checked_div(total_qf)
                    .unwrap_or(0);
                remainder -= a;
                a
            };
            result.push_back(pid);
            result.push_back(alloc);
        }
        Ok(result)
    }

    pub fn get_project_contributions(
        env: Env,
        round_id: u64,
        project_id: u64,
    ) -> Result<i128, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::ProjectContributions(round_id, project_id);
        let value = env.storage().persistent().get(&key).unwrap_or(0);
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    pub fn get_contributor_count(
        env: Env,
        round_id: u64,
        project_id: u64,
    ) -> Result<u32, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::ProjectContributorCount(round_id, project_id);
        let value = env.storage().persistent().get(&key).unwrap_or(0);
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    /// The round-level contribution cap (0 means uncapped).
    pub fn get_round_cap(env: Env, round_id: u64) -> Result<i128, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::RoundCap(round_id);
        let value = env.storage().persistent().get(&key).unwrap_or(0);
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    /// A contributor's cumulative recorded contributions to a round, summed
    /// across every project in that round.
    pub fn get_contributor_round_total(
        env: Env,
        round_id: u64,
        contributor: Address,
    ) -> Result<i128, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::ContributorRoundTotal(round_id, contributor);
        let value = env.storage().persistent().get(&key).unwrap_or(0);
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    pub fn get_round_status(env: Env, round_id: u64) -> Result<Symbol, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::RoundStatus(round_id);
        let value = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Symbol::new(&env, "ACTIVE"));
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    pub fn get_finalized_at(env: Env, round_id: u64) -> Result<u64, MatchingPoolError> {
        Self::read_round(&env, round_id)?;
        let key = DataKey::FinalizedAt(round_id);
        let value = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Self::touch_persistent(&env, &key);
        Ok(value)
    }

    pub fn get_admin(env: Env) -> Result<Address, MatchingPoolError> {
        let admin = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(MatchingPoolError::NotInitialized)?;
        Self::touch_instance(&env);
        Ok(admin)
    }

    // ── Granular pause / unpause ─────────────────────────────────────────────

    /// Pause a specific subsystem scope. Admin-only.
    ///
    /// Read-only queries are never affected by any scope.
    pub fn pause_scope(
        env: Env,
        admin: Address,
        scope: PauseScope,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::ScopePaused(scope), &true);
        events::ScopePauseChangedEvent {
            admin,
            scope: scope as u32,
            paused: true,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Unpause a specific subsystem scope. Admin-only.
    pub fn unpause_scope(
        env: Env,
        admin: Address,
        scope: PauseScope,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::ScopePaused(scope), &false);
        events::ScopePauseChangedEvent {
            admin,
            scope: scope as u32,
            paused: false,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Legacy whole-contract pause (kept for backward-compatibility).
    /// Prefer `pause_scope` for new integrations.
    pub fn pause(env: Env, admin: Address) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        events::ContractPauseEvent {
            admin,
            paused: true,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Legacy whole-contract unpause (kept for backward-compatibility).
    /// Prefer `unpause_scope` for new integrations.
    pub fn unpause(env: Env, admin: Address) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        events::ContractUnpauseEvent {
            admin,
            paused: false,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Read-only: returns `true` when a given scope is currently paused.
    /// Never modifies state and is always callable regardless of pause status.
    pub fn is_paused(env: Env, scope: PauseScope) -> bool {
        Self::is_scope_paused(&env, scope)
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &current_admin)?;
        Self::require_governance_not_paused(&env)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        events::AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &caller)?;
        Self::require_governance_not_paused(&env)?;
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        events::UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
#[cfg(test)]
mod tests;
