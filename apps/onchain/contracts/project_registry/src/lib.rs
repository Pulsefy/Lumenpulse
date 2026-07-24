#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use multisig_guard::{
    cancel as multisig_cancel, configure as multisig_configure, consume_approval,
    expire as multisig_expire, get_config as multisig_get_config, get_proposal,
    propose as multisig_propose, replace_config as multisig_replace_config, sign as multisig_sign,
    MultisigConfig, MultisigDataKey, Proposal, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, IntoVal, Symbol, Vec};
use storage::{DataKey, ProjectEntry, ProposalAction, RegistryConfig, VerificationStatus, WeightMode};

pub use storage::ProposalAction as ProjectProposalAction;

#[contract]
pub struct ProjectRegistryContract;

#[contractimpl]
impl ProjectRegistryContract {
    // ── Helpers ──────────────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        if caller != &admin {
            return Err(RegistryError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), RegistryError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(RegistryError::ContractPaused);
        }
        Ok(())
    }

    /// Resolve voter weight based on the configured WeightMode.
    /// Returns 0 if the voter does not meet the minimum weight requirement.
    fn resolve_weight(env: &Env, config: &RegistryConfig, voter: &Address) -> i128 {
        let weight = match config.weight_mode {
            WeightMode::Reputation => {
                if let Some(ref registry) = config.contributor_registry {
                    let score: u64 = env.invoke_contract(
                        registry,
                        &Symbol::new(env, "get_reputation"),
                        soroban_sdk::vec![env, voter.into_val(env)],
                    );
                    score as i128
                } else {
                    0
                }
            }
            WeightMode::TokenBalance => {
                if let Some(ref token) = config.governance_token {
                    TokenClient::new(env, token).balance(voter)
                } else {
                    0
                }
            }
            WeightMode::Flat => {
                if let Some(ref registry) = config.contributor_registry {
                    let exists: bool = env.invoke_contract(
                        registry,
                        &Symbol::new(env, "is_registered"),
                        soroban_sdk::vec![env, voter.into_val(env)],
                    );
                    if exists {
                        1
                    } else {
                        0
                    }
                } else {
                    1
                }
            }
        };
        weight
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        quorum_threshold: i128,
        weight_mode: WeightMode,
        governance_token: Option<Address>,
        contributor_registry: Option<Address>,
        min_voter_weight: i128,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        if quorum_threshold <= 0 {
            return Err(RegistryError::InvalidThreshold);
        }
        admin.require_auth();

        let config = RegistryConfig {
            quorum_threshold,
            weight_mode,
            governance_token,
            contributor_registry,
            min_voter_weight,
        };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Config, &config);

        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn configure_multisig(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), RegistryError> {
        multisig_configure(&env, signers.clone(), threshold).map_err(|_| RegistryError::Unauthorized)?;
        Ok(())
    }

    // ── Multisig proposal lifecycle ──────────────────────────

    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, RegistryError> {
        let payload = vec![&env, action.into_val(&env)];
        multisig_propose(&env, proposer, payload).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn sign_proposal(env: Env, signer: Address, proposal_id: u64) -> Result<(), RegistryError> {
        multisig_sign(&env, signer, proposal_id).map_err(|_| RegistryError::Unauthorized)?;
        Ok(())
    }

    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), RegistryError> {
        multisig_cancel(&env, signer, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), RegistryError> {
        multisig_expire(&env, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    pub fn get_multisig_config(env: Env) -> Result<MultisigConfig, RegistryError> {
        multisig_get_config(&env).map_err(|_| RegistryError::NotInitialized)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, RegistryError> {
        get_proposal(&env, proposal_id).map_err(|_| RegistryError::Unauthorized)
    }

    // ── Project registration ──────────────────────────────────────────────────

    pub fn register_project(
        env: Env,
        owner: Address,
        project_id: u64,
        name: Symbol,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        owner.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Project(project_id))
        {
            return Err(RegistryError::ProjectAlreadyRegistered);
        }

        let entry = ProjectEntry {
            project_id,
            owner: owner.clone(),
            name: name.clone(),
            status: VerificationStatus::Pending,
            votes_for: 0,
            votes_against: 0,
            registered_at: env.ledger().timestamp(),
            resolved_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);

        events::ProjectRegisteredEvent {
            project_id,
            owner,
            name,
        }
        .publish(&env);

        Ok(())
    }

    // ── Community voting ──────────────────────────────────────────────────────

    pub fn cast_vote(
        env: Env,
        voter: Address,
        project_id: u64,
        support: bool,
    ) -> Result<VerificationStatus, RegistryError> {
        Self::require_not_paused(&env)?;
        voter.require_auth();

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        if entry.status != VerificationStatus::Pending {
            return Err(RegistryError::VotingClosed);
        }

        let vote_key = DataKey::VoteCast(project_id, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(RegistryError::AlreadyVoted);
        }

        let config: RegistryConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)?;

        let weight = Self::resolve_weight(&env, &config, &voter);

        if weight < config.min_voter_weight {
            return Err(RegistryError::InsufficientWeight);
        }

        env.storage().persistent().set(&vote_key, &true);
        env.storage()
            .persistent()
            .set(&DataKey::VoterWeight(project_id, voter.clone()), &weight);

        if support {
            entry.votes_for = entry.votes_for.saturating_add(weight);
        } else {
            entry.votes_against = entry.votes_against.saturating_add(weight);
        }

        events::VoteCastEvent {
            project_id,
            voter,
            weight,
            support,
        }
        .publish(&env);

        if entry.votes_for >= config.quorum_threshold {
            entry.status = VerificationStatus::Verified;
            entry.resolved_at = env.ledger().timestamp();
            events::ProjectVerifiedEvent {
                project_id,
                votes_for: entry.votes_for,
                votes_against: entry.votes_against,
            }
            .publish(&env);
        } else if entry.votes_against >= config.quorum_threshold {
            entry.status = VerificationStatus::Rejected;
            entry.resolved_at = env.ledger().timestamp();
            events::ProjectRejectedEvent {
                project_id,
                votes_for: entry.votes_for,
                votes_against: entry.votes_against,
            }
            .publish(&env);
        }

        let status = entry.status.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);

        Ok(status)
    }

    // ── Admin override ────────────────────────────────────────────────────────

    pub fn force_verify_project_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        project_id: u64,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::ForceVerifyProject(project_id).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        entry.status = VerificationStatus::Verified;
        entry.resolved_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);

        events::VerificationOverriddenEvent {
            project_id,
            admin: executor,
            verified: true,
        }
        .publish(&env);

        Ok(())
    }

    pub fn force_reject_project_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        project_id: u64,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::ForceRejectProject(project_id).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        entry.status = VerificationStatus::Rejected;
        entry.resolved_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);

        events::VerificationOverriddenEvent {
            project_id,
            admin: executor,
            verified: false,
        }
        .publish(&env);

        Ok(())
    }


    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_project(env: Env, project_id: u64) -> Result<ProjectEntry, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)
    }

    pub fn is_verified(env: Env, project_id: u64) -> bool {
        env.storage()
            .persistent()
            .get::<_, ProjectEntry>(&DataKey::Project(project_id))
            .map(|e| e.status == VerificationStatus::Verified)
            .unwrap_or(false)
    }

    pub fn has_voted(env: Env, project_id: u64, voter: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::VoteCast(project_id, voter))
    }

    pub fn get_voter_weight(env: Env, project_id: u64, voter: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::VoterWeight(project_id, voter))
            .unwrap_or(0)
    }

    pub fn get_config(env: Env) -> Result<RegistryConfig, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    pub fn update_config_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        config: RegistryConfig,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::SetConfig(config.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;

        if config.quorum_threshold <= 0 {
            return Err(RegistryError::InvalidThreshold);
        }
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    pub fn pause_via_multisig(env: Env, executor: Address, proposal_id: u64) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Pause.into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause_via_multisig(env: Env, executor: Address, proposal_id: u64) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Unpause.into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn set_admin_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::SetAdmin(new_admin.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn upgrade_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let expected_payload = vec![&env, ProposalAction::Upgrade(new_wasm_hash.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| RegistryError::Unauthorized)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
