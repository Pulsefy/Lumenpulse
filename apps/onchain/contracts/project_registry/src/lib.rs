#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, IntoVal, Symbol};
use storage::{DataKey, ProjectEntry, RegistryConfig, VerificationStatus, WeightMode};

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
                // Read reputation_score from contributor_registry via cross-contract call.
                // The contributor_registry exposes get_reputation(contributor) -> u64.
                // We call it generically via invoke_contract.
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
                // Any registered contributor gets weight 1.
                // We check registration via contributor_registry if configured,
                // otherwise grant weight 1 to any caller.
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

    /// Deploy and configure the registry.
    ///
    /// `quorum_threshold` — total weight-for votes needed to auto-verify.
    /// `weight_mode`      — Reputation | TokenBalance | Flat.
    /// `governance_token` — required when weight_mode = TokenBalance.
    /// `contributor_registry` — required when weight_mode = Reputation | Flat.
    /// `min_voter_weight` — minimum weight a voter must hold to participate.
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

    // ── Project registration ──────────────────────────────────────────────────

    /// Register a project for community verification.
    /// Anyone can register a project they own.
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

    /// Cast a verification vote for a project.
    ///
    /// Weight is determined by the configured WeightMode:
    ///   - Reputation: contributor_registry.get_reputation(voter)
    ///   - TokenBalance: governance_token.balance(voter)
    ///   - Flat: 1 per registered contributor
    ///
    /// If votes_for reaches quorum_threshold the project is auto-verified.
    /// If votes_against reaches quorum_threshold the project is auto-rejected.
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

        // Only pending projects accept votes
        if entry.status != VerificationStatus::Pending {
            return Err(RegistryError::VotingClosed);
        }

        // Prevent double voting
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

        // Record vote
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

        // Auto-resolve if quorum reached
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

    /// Admin can override verification status (e.g. emergency revocation).
    pub fn override_verification(
        env: Env,
        admin: Address,
        project_id: u64,
        verified: bool,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        entry.status = if verified {
            VerificationStatus::Verified
        } else {
            VerificationStatus::Rejected
        };
        entry.resolved_at = env.ledger().timestamp();

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);

        events::VerificationOverriddenEvent {
            project_id,
            admin,
            verified,
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

    pub fn update_config(
        env: Env,
        admin: Address,
        quorum_threshold: i128,
        min_voter_weight: i128,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        if quorum_threshold <= 0 {
            return Err(RegistryError::InvalidThreshold);
        }
        let mut config: RegistryConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)?;
        config.quorum_threshold = quorum_threshold;
        config.min_voter_weight = min_voter_weight;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &current_admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
