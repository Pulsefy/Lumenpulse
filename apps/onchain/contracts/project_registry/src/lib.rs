#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, IntoVal, Symbol};
use storage::{
    DataKey, ProjectEntry, RegistryConfig, VerificationStatus, WeightMode, LEDGER_BUMP,
    LEDGER_THRESHOLD,
};

fn transition_to_archived(env: &Env, entry: &mut ProjectEntry) {
    entry.status = VerificationStatus::Archived;
    entry.resolved_at = env.ledger().timestamp();
}

#[contract]
pub struct ProjectRegistryContract;

#[contractimpl]
impl ProjectRegistryContract {
    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Extends the shared instance-storage TTL (covers `Admin`, `Paused`,
    /// `Config` at once). Called from both `require_admin` and
    /// `require_not_paused` so that instance data stays alive as long as the
    /// registry is receiving either admin writes or ordinary
    /// register/vote traffic — not just admin writes, which may be rare
    /// long after initial setup.
    fn touch_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

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
        Self::touch_instance(env);
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
        Self::touch_instance(env);
        Ok(())
    }

    /// Extends the TTL of a project's persistent record.
    fn touch_project(env: &Env, project_id: u64) {
        env.storage().persistent().extend_ttl(
            &DataKey::Project(project_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
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
        Self::touch_project(&env, project_id);

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
        Self::touch_project(&env, project_id);

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
            .extend_ttl(&vote_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        let weight_key = DataKey::VoterWeight(project_id, voter.clone());
        env.storage().persistent().set(&weight_key, &weight);
        env.storage()
            .persistent()
            .extend_ttl(&weight_key, LEDGER_THRESHOLD, LEDGER_BUMP);

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
        Self::touch_project(&env, project_id);

        Ok(status)
    }

    // ── Lifecycle/admin archival ──────────────────────────────────────────────

    /// Archive a project record without deleting it so historical consumers can
    /// continue to query the project by ID while it is no longer active.
    pub fn archive_project(env: Env, admin: Address, project_id: u64) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        transition_to_archived(&env, &mut entry);

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);
        Self::touch_project(&env, project_id);

        events::ProjectArchivedEvent {
            admin,
            project_id,
            archived_at: entry.resolved_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Alias for archival in registry terms: delist the project from active
    /// governance participation while preserving the record for historical reads.
    pub fn delist_project(env: Env, admin: Address, project_id: u64) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: ProjectEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;

        transition_to_archived(&env, &mut entry);

        env.storage()
            .persistent()
            .set(&DataKey::Project(project_id), &entry);
        Self::touch_project(&env, project_id);

        events::ProjectDelistedEvent {
            admin,
            project_id,
            delisted_at: entry.resolved_at,
        }
        .publish(&env);

        Ok(())
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
        Self::touch_project(&env, project_id);

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
        let entry = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)?;
        Self::touch_project(&env, project_id);
        Ok(entry)
    }

    pub fn is_verified(env: Env, project_id: u64) -> bool {
        let entry: Option<ProjectEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::Project(project_id));
        if entry.is_some() {
            Self::touch_project(&env, project_id);
        }
        entry
            .map(|e| e.status == VerificationStatus::Verified)
            .unwrap_or(false)
    }

    pub fn has_voted(env: Env, project_id: u64, voter: Address) -> bool {
        let key = DataKey::VoteCast(project_id, voter);
        let voted = env.storage().persistent().has(&key);
        if voted {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        voted
    }

    pub fn get_voter_weight(env: Env, project_id: u64, voter: Address) -> i128 {
        let key = DataKey::VoterWeight(project_id, voter);
        let weight = env.storage().persistent().get(&key);
        if weight.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        weight.unwrap_or(0)
    }

    pub fn get_config(env: Env) -> Result<RegistryConfig, RegistryError> {
        let config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)?;
        Self::touch_instance(&env);
        Ok(config)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        let admin = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        Self::touch_instance(&env);
        Ok(admin)
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
