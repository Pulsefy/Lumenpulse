#![no_std]

mod errors;
mod events;
mod math;
mod storage;

use errors::MatchingPoolError;
use math::{sqrt_scaled, unscale};
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, Symbol, Vec};
use storage::{DataKey, RoundData};

#[contract]
pub struct MatchingPoolContract;

#[contractimpl]
impl MatchingPoolContract {
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
        Ok(())
    }

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
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::NextRoundId, &0u64);
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
        Self::require_not_paused(&env)?;
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
        env.storage()
            .persistent()
            .set(&DataKey::RoundPool(round_id), &0i128);
        env.storage()
            .persistent()
            .set(&DataKey::EligibleProjectCount(round_id), &0u32);
        env.storage()
            .persistent()
            .set(&DataKey::MatchDistributed(round_id), &false);
        env.storage().persistent().set(
            &DataKey::RoundStatus(round_id),
            &Symbol::new(&env, "ACTIVE"),
        );
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
            Self::require_not_paused(&env)?;
            funder.require_auth();
            if amount <= 0 {
                return Err(MatchingPoolError::InvalidAmount);
            }
            let mut round: RoundData = env
                .storage()
                .persistent()
                .get(&DataKey::Round(round_id))
                .ok_or(MatchingPoolError::RoundNotFound)?;
            if round.is_finalized {
                return Err(MatchingPoolError::RoundAlreadyFinalized);
            }
            let pool_key = DataKey::RoundPool(round_id);
            let current: i128 = env.storage().persistent().get(&pool_key).unwrap_or(0);
            env.storage()
                .persistent()
                .set(&pool_key, &(current + amount));
            round.total_pool += amount;
            env.storage()
                .persistent()
                .set(&DataKey::Round(round_id), &round);

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
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
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
        let count_key = DataKey::EligibleProjectCount(round_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::EligibleProjectAt(round_id, count), &project_id);
        env.storage().persistent().set(&count_key, &(count + 1));
        env.storage()
            .persistent()
            .set(&DataKey::ProjectContributions(round_id, project_id), &0i128);
        env.storage().persistent().set(
            &DataKey::ProjectContributorCount(round_id, project_id),
            &0u32,
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
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
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
        events::ProjectRemovedEvent {
            round_id,
            project_id,
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
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(MatchingPoolError::InvalidAmount);
        }
        let round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        let now = env.ledger().timestamp();
        if now < round.start_time || now > round.end_time {
            return Err(MatchingPoolError::RoundNotActive);
        }
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::EligibleProject(round_id, project_id))
            .unwrap_or(false)
        {
            return Err(MatchingPoolError::ProjectNotEligible);
        }
        let contrib_key = DataKey::ContributorAmount(round_id, project_id, contributor.clone());
        let prev: i128 = env.storage().persistent().get(&contrib_key).unwrap_or(0);
        if prev == 0 {
            let cnt_key = DataKey::ProjectContributorCount(round_id, project_id);
            let cnt: u32 = env.storage().persistent().get(&cnt_key).unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::ProjectContributor(round_id, project_id, cnt),
                &contributor,
            );
            env.storage().persistent().set(&cnt_key, &(cnt + 1));
        }
        env.storage()
            .persistent()
            .set(&contrib_key, &(prev + amount));
        let total_key = DataKey::ProjectContributions(round_id, project_id);
        let total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&total_key, &(total + amount));
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
        Self::require_admin(&env, &admin)?;
        let mut round: RoundData = env
            .storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        if round.is_finalized {
            return Err(MatchingPoolError::RoundAlreadyFinalized);
        }
        if env.ledger().timestamp() <= round.end_time {
            return Err(MatchingPoolError::RoundStillOpen);
        }
        round.is_finalized = true;
        env.storage()
            .persistent()
            .set(&DataKey::Round(round_id), &round);
        env.storage().persistent().set(
            &DataKey::RoundStatus(round_id),
            &Symbol::new(&env, "FINALIZED"),
        );
        events::RoundFinalizedEvent { round_id, admin }.publish(&env);
        Ok(())
    }

    pub fn distribute_matching_funds(
        env: Env,
        admin: Address,
        round_id: u64,
        project_owners: Vec<Address>,
    ) -> Result<i128, MatchingPoolError> {
        Self::with_reentrancy_guard(&env, || {
            Self::require_admin(&env, &admin)?;
            let mut round: RoundData = env
                .storage()
                .persistent()
                .get(&DataKey::Round(round_id))
                .ok_or(MatchingPoolError::RoundNotFound)?;
            if !round.is_finalized {
                return Err(MatchingPoolError::RoundNotFinalized);
            }
            if round.is_distributed {
                return Err(MatchingPoolError::MatchAlreadyDistributed);
            }
            let count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::EligibleProjectCount(round_id))
                .unwrap_or(0);
            if count == 0 {
                return Err(MatchingPoolError::NoEligibleProjects);
            }

            let mut project_ids: Vec<u64> = vec![&env];
            let mut qf_scores: Vec<i128> = vec![&env];
            let mut total_qf: i128 = 0;

            for i in 0..count {
                let pid: u64 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::EligibleProjectAt(round_id, i))
                    .unwrap_or(u64::MAX);
                if !env
                    .storage()
                    .persistent()
                    .get::<_, bool>(&DataKey::EligibleProject(round_id, pid))
                    .unwrap_or(false)
                {
                    continue;
                }
                let score = Self::compute_qf_score(&env, round_id, pid);
                project_ids.push_back(pid);
                qf_scores.push_back(score);
                total_qf = total_qf.saturating_add(score);
            }

            if total_qf == 0 {
                return Ok(0);
            }

            let pool: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::RoundPool(round_id))
                .unwrap_or(0);
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
            env.storage().persistent().set(
                &DataKey::RoundStatus(round_id),
                &Symbol::new(&env, "DISTRIBUTED"),
            );
            env.storage()
                .persistent()
                .set(&DataKey::MatchDistributed(round_id), &true);
            env.storage()
                .persistent()
                .set(&DataKey::RoundPool(round_id), &0i128);

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
        let cnt: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::ProjectContributorCount(round_id, project_id))
            .unwrap_or(0);
        if cnt == 0 {
            return 0;
        }
        let mut sum_sqrt: i128 = 0;
        for i in 0..cnt {
            let contributor: Address = match env
                .storage()
                .persistent()
                .get(&DataKey::ProjectContributor(round_id, project_id, i))
            {
                Some(a) => a,
                None => continue,
            };
            let amount: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ContributorAmount(
                    round_id,
                    project_id,
                    contributor,
                ))
                .unwrap_or(0);
            if amount > 0 {
                sum_sqrt = sum_sqrt.saturating_add(sqrt_scaled(amount));
            }
        }
        let squared = sum_sqrt.checked_mul(sum_sqrt).unwrap_or(i128::MAX);
        unscale(unscale(squared))
    }

    pub fn get_round(env: Env, round_id: u64) -> Result<RoundData, MatchingPoolError> {
        env.storage()
            .persistent()
            .get(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)
    }

    pub fn get_pool_balance(env: Env, round_id: u64) -> Result<i128, MatchingPoolError> {
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::RoundPool(round_id))
            .unwrap_or(0))
    }

    pub fn get_project_qf_score(
        env: Env,
        round_id: u64,
        project_id: u64,
    ) -> Result<i128, MatchingPoolError> {
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Ok(Self::compute_qf_score(&env, round_id, project_id))
    }

    pub fn preview_distribution(env: Env, round_id: u64) -> Result<Vec<i128>, MatchingPoolError> {
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::EligibleProjectCount(round_id))
            .unwrap_or(0);
        let pool: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RoundPool(round_id))
            .unwrap_or(0);
        let mut result: Vec<i128> = vec![&env];
        if count == 0 || pool == 0 {
            return Ok(result);
        }
        let mut total_qf: i128 = 0;
        let mut scores: Vec<i128> = vec![&env];
        let mut pids: Vec<i128> = vec![&env];
        for i in 0..count {
            let pid: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::EligibleProjectAt(round_id, i))
                .unwrap_or(u64::MAX);
            if !env
                .storage()
                .persistent()
                .get::<_, bool>(&DataKey::EligibleProject(round_id, pid))
                .unwrap_or(false)
            {
                continue;
            }
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
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::ProjectContributions(round_id, project_id))
            .unwrap_or(0))
    }

    pub fn get_contributor_count(
        env: Env,
        round_id: u64,
        project_id: u64,
    ) -> Result<u32, MatchingPoolError> {
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::ProjectContributorCount(round_id, project_id))
            .unwrap_or(0))
    }

    pub fn get_round_status(env: Env, round_id: u64) -> Result<Symbol, MatchingPoolError> {
        env.storage()
            .persistent()
            .get::<_, RoundData>(&DataKey::Round(round_id))
            .ok_or(MatchingPoolError::RoundNotFound)?;
        Ok(env
            .storage()
            .persistent()
            .get(&DataKey::RoundStatus(round_id))
            .unwrap_or(Symbol::new(&env, "ACTIVE")))
    }

    pub fn get_admin(env: Env) -> Result<Address, MatchingPoolError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(MatchingPoolError::NotInitialized)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &current_admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), MatchingPoolError> {
        Self::require_admin(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
