#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, IntoVal, Symbol};
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
    /// `timelock_contract` — optional timelock contract address for admin actions
    pub fn initialize(
        env: Env,
        admin: Address,
        quorum_threshold: i128,
        weight_mode: WeightMode,
        governance_token: Option<Address>,
        contributor_registry: Option<Address>,
        min_voter_weight: i128,
        timelock_contract: Option<Address>,
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
        
        if let Some(ref timelock) = timelock_contract {
            env.storage().instance().set(&DataKey::TimelockContract, timelock);
        }

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

    /// Check if timelock is enabled
    fn is_timelock_enabled(env: &Env) -> bool {
        env.storage().instance().has(&DataKey::TimelockContract)
    }

    /// Get timelock contract address
    fn get_timelock_contract(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TimelockContract)
    }

    /// Queue a timelocked admin action
    fn queue_timelocked_action(
        env: &Env,
        admin: &Address,
        action_type: Symbol,
        payload: Bytes,
        delay: u64,
    ) -> Result<BytesN<32>, RegistryError> {
        let timelock = Self::get_timelock_contract(env)
            .ok_or(RegistryError::TimelockNotConfigured)?;

        // Call timelock contract to queue the action
        let proposal_id: BytesN<32> = env.invoke_contract(
            &timelock,
            &Symbol::new(env, "queue_action"),
            soroban_sdk::vec![
                env,
                admin.into_val(env),
                action_type.into_val(env),
                env.current_contract_address().into_val(env),
                payload.into_val(env),
                delay.into_val(env),
            ],
        );

        Ok(proposal_id)
    }

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

        // If timelock is enabled, queue the action instead of executing immediately
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&(quorum_threshold, min_voter_weight));
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &admin,
                Symbol::new(&env, "update_config"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin,
                action: Symbol::new(&env, "update_config"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }

        // Immediate execution if no timelock
        let mut config: RegistryConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)?;
        config.quorum_threshold = quorum_threshold;
        config.min_voter_weight = min_voter_weight;
        env.storage().instance().set(&DataKey::Config, &config);
        
        events::ConfigUpdatedEvent {
            admin,
            quorum_threshold,
            min_voter_weight,
        }.publish(&env);
        
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        
        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&());
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &admin,
                Symbol::new(&env, "pause"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin,
                action: Symbol::new(&env, "pause"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }
        
        env.storage().instance().set(&DataKey::Paused, &true);
        events::ContractPausedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        
        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&());
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &admin,
                Symbol::new(&env, "unpause"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin,
                action: Symbol::new(&env, "unpause"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }
        
        env.storage().instance().set(&DataKey::Paused, &false);
        events::ContractUnpausedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &current_admin)?;
        
        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&new_admin);
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &current_admin,
                Symbol::new(&env, "set_admin"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin: current_admin,
                action: Symbol::new(&env, "set_admin"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }
        
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        events::AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }.publish(&env);
        Ok(())
    }

    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &caller)?;
        
        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&new_wasm_hash);
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &caller,
                Symbol::new(&env, "upgrade"),
                payload,
                172800, // 48 hour delay for upgrades (more critical)
            )?;
            
            events::AdminActionQueuedEvent {
                admin: caller,
                action: Symbol::new(&env, "upgrade"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }
        
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        events::ContractUpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }.publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
