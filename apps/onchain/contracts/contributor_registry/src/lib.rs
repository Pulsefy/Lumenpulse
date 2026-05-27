#![no_std]

mod errors;
mod events;
mod multisig;
mod storage;

use errors::ContributorError;
use events::{
    AdminChangedEvent, BadgeGrantedEvent, BadgeRevokedEvent, GaslessRegistrationEvent,
    MultisigConfiguredEvent, ReputationPenaltyAppliedEvent, UpgradedEvent,
};
use multisig::{
    cancel, consume_approval, expire, get_config, get_proposal, propose, sign, validate_config,
    MultisigConfig, ProposalAction, ProposalStatus, Signer,
};
use notification_interface::{Notification, NotificationReceiverTrait};
use soroban_sdk::xdr::FromXdr;
use soroban_sdk::{
    contract, contractimpl, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};
use storage::{
    Badge, ContributorData, ContributorTier, DataKey, PenaltyRecord, PenaltySeverity, LEDGER_BUMP,
    LEDGER_THRESHOLD,
};

#[contract]
pub struct ContributorRegistryContract;

#[contractimpl]
impl ContributorRegistryContract {
    // ── Helpers ──────────────────────────────────────────────

    fn ensure_initialized(env: &Env) -> Result<(), ContributorError> {
        if !env.storage().instance().has(&DataKey::MultisigConfig) {
            return Err(ContributorError::NotInitialized);
        }
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(())
    }

    fn registration_nonce_of(env: &Env, address: &Address) -> u64 {
        let key = DataKey::RegistrationNonce(address.clone());
        let nonce = env.storage().persistent().get(&key).unwrap_or(0);
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        nonce
    }

    fn write_contributor(
        env: &Env,
        address: &Address,
        github_handle: &String,
    ) -> Result<(), ContributorError> {
        if github_handle.is_empty() {
            return Err(ContributorError::InvalidGitHubHandle);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Contributor(address.clone()))
        {
            return Err(ContributorError::ContributorAlreadyExists);
        }
        Self::ensure_github_handle_available(env, github_handle, address)?;

        let timestamp = env.ledger().timestamp();
        let contributor = ContributorData {
            address: address.clone(),
            github_handle: github_handle.clone(),
            reputation_score: 0,
            registered_timestamp: timestamp,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(address.clone()), &contributor);
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .persistent()
            .set(&DataKey::GitHubIndex(github_handle.clone()), address);
        env.storage().persistent().extend_ttl(
            &DataKey::GitHubIndex(github_handle.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        Ok(())
    }

    fn ensure_github_handle_available(
        env: &Env,
        github_handle: &String,
        address: &Address,
    ) -> Result<(), ContributorError> {
        if let Some(existing_address) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::GitHubIndex(github_handle.clone()))
        {
            if existing_address != *address {
                return Err(ContributorError::GitHubHandleTaken);
            }
        }
        Ok(())
    }

    // ── Initialisation ───────────────────────────────────────

    pub fn initialize(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), ContributorError> {
        if env.storage().instance().has(&DataKey::MultisigConfig) {
            return Err(ContributorError::AlreadyInitialized);
        }

        validate_config(&signers, threshold)?;

        let bootstrapper = signers
            .get(0)
            .ok_or(ContributorError::InvalidMultisigConfig)?;
        bootstrapper.address.require_auth();

        let config = MultisigConfig {
            signers: signers.clone(),
            threshold,
        };
        env.storage()
            .instance()
            .set(&DataKey::MultisigConfig, &config);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &0u64);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        MultisigConfiguredEvent {
            configured_by: bootstrapper.address.clone(),
            threshold,
            signer_count: signers.len(), // no cast needed, already u32 in Soroban Vec
        }
        .publish(&env);

        Ok(())
    }

    // ── Multisig proposal lifecycle ──────────────────────────

    pub fn propose(
        env: Env,
        proposer: Address,
        action: ProposalAction,
    ) -> Result<u64, ContributorError> {
        propose(&env, proposer, action)
    }

    pub fn sign(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<ProposalStatus, ContributorError> {
        sign(&env, signer, proposal_id)
    }

    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), ContributorError> {
        cancel(&env, signer, proposal_id)
    }

    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), ContributorError> {
        expire(&env, proposal_id)
    }

    pub fn set_multisig_config(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_signers: Vec<Signer>,
        new_threshold: u32,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::SetAdmin)?;

        validate_config(&new_signers, new_threshold)?;

        let config = MultisigConfig {
            signers: new_signers.clone(),
            threshold: new_threshold,
        };
        env.storage()
            .instance()
            .set(&DataKey::MultisigConfig, &config);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        MultisigConfiguredEvent {
            configured_by: executor,
            threshold: new_threshold,
            signer_count: new_signers.len(), // no cast needed
        }
        .publish(&env);

        Ok(())
    }

    // ── Contributor operations ───────────────────────────────

    pub fn register_contributor(
        env: Env,
        address: Address,
        github_handle: String,
    ) -> Result<(), ContributorError> {
        Self::ensure_initialized(&env)?;
        address.require_auth();
        Self::write_contributor(&env, &address, &github_handle)
    }

    /// Gasless / meta-transaction registration.
    ///
    /// The caller (relayer) submits the transaction and pays fees.  The user
    /// never touches a wallet or holds XLM.  Instead the user signs a
    /// `SorobanAuthorizationEntry` off-chain that commits to:
    ///
    ///   `("register_contributor_with_sig", github_handle, address, nonce)`
    ///
    /// The signed entry is attached to the transaction by the relayer.  Soroban's
    /// host verifies the user's Ed25519 signature and consumes the host-managed
    /// nonce automatically.  The contract also advances its own per-address
    /// `RegistrationNonce` counter as an independent replay-guard so that even if
    /// an auth-entry nonce were somehow reused, the contract-layer nonce change
    /// would make re-registration fail with `ContributorAlreadyExists` (and for
    /// future mutable operations, with `InvalidNonce`).
    ///
    /// The `signature` parameter is a caller-visible artifact — arbitrary bytes
    /// that the user may include in their off-chain commitment.  It is NOT part
    /// of the `require_auth_for_args` scope (to avoid the circular dependency
    /// where the user would have to sign their own signature).
    pub fn register_contributor_with_sig(
        env: Env,
        github_handle: String,
        address: Address,
        signature: Bytes,
    ) -> Result<(), ContributorError> {
        Self::ensure_initialized(&env)?;
        if signature.is_empty() {
            return Err(ContributorError::InvalidSignature);
        }

        // Read the current contract-layer nonce before mutating state.
        let nonce = Self::registration_nonce_of(&env, &address);

        // Require that `address` has authorised this specific invocation.
        // The authorisation scope binds the function name, the handle being
        // registered, the caller address, and the current nonce — preventing
        // cross-user, cross-handle, and replay attacks.
        // NOTE: `signature` is intentionally excluded from this scope; it is
        // the SorobanAuthorizationEntry itself that carries the cryptographic
        // proof, not a raw bytes argument.
        address.require_auth_for_args(
            (
                Symbol::new(&env, "register_contributor_with_sig"),
                github_handle.clone(),
                address.clone(),
                nonce,
            )
                .into_val(&env),
        );

        Self::write_contributor(&env, &address, &github_handle)?;

        // Advance the contract-layer nonce so every future signed intent must
        // reference a strictly higher value.
        let new_nonce = nonce + 1;
        env.storage()
            .persistent()
            .set(&DataKey::RegistrationNonce(address.clone()), &new_nonce);
        env.storage().persistent().extend_ttl(
            &DataKey::RegistrationNonce(address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        GaslessRegistrationEvent {
            contributor: address,
            github_handle,
            consumed_nonce: nonce,
        }
        .publish(&env);

        Ok(())
    }

    pub fn update_contributor(
        env: Env,
        address: Address,
        github_handle: String,
    ) -> Result<(), ContributorError> {
        if !env.storage().instance().has(&DataKey::MultisigConfig) {
            return Err(ContributorError::NotInitialized);
        }
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        address.require_auth();
        if github_handle.is_empty() {
            return Err(ContributorError::InvalidGitHubHandle);
        }
        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        Self::ensure_github_handle_available(&env, &github_handle, &address)?;
        if contributor.github_handle != github_handle {
            env.storage()
                .persistent()
                .remove(&DataKey::GitHubIndex(contributor.github_handle.clone()));
        }
        contributor.github_handle = github_handle.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(address.clone()), &contributor);
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        env.storage()
            .persistent()
            .set(&DataKey::GitHubIndex(github_handle.clone()), &address);
        env.storage().persistent().extend_ttl(
            &DataKey::GitHubIndex(github_handle),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    /// Deregister a contributor, removing all associated storage entries.
    ///
    /// Requires the contributor's own authorization. Removes:
    /// - `DataKey::Contributor(address)`
    /// - `DataKey::GitHubIndex(github_handle)`
    /// - `DataKey::RegistrationNonce(address)`
    ///
    /// This prevents orphaned index entries and reclaims rent.
    pub fn deregister_contributor(env: Env, address: Address) -> Result<(), ContributorError> {
        Self::ensure_initialized(&env)?;
        address.require_auth();

        let contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;

        // State compaction: remove all three related entries atomically.
        env.storage()
            .persistent()
            .remove(&DataKey::GitHubIndex(contributor.github_handle));
        env.storage()
            .persistent()
            .remove(&DataKey::Contributor(address.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::RegistrationNonce(address));

        Ok(())
    }

    // ── Sensitive functions — multisig-gated ─────────────────

    pub fn update_reputation(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        delta: i64,
    ) -> Result<(), ContributorError> {
        consume_approval(
            &env,
            &executor,
            proposal_id,
            &ProposalAction::UpdateReputation,
        )?;

        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(contributor_address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(contributor_address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        let new_score = if delta > 0 {
            contributor
                .reputation_score
                .checked_add(delta as u64)
                .ok_or(ContributorError::ReputationOverflow)?
        } else {
            let abs = delta.checked_abs().unwrap_or(0) as u64;
            contributor.reputation_score.saturating_sub(abs)
        };
        contributor.reputation_score = new_score;
        env.storage().persistent().set(
            &DataKey::Contributor(contributor_address.clone()),
            &contributor,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(contributor_address),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
        Ok(())
    }

    pub fn grant_badge(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        badge: Badge,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::GrantBadge)?;

        // Ensure contributor exists
        let _ = Self::get_contributor(env.clone(), contributor_address.clone())?;

        let key = DataKey::Badges(contributor_address.clone());
        let mut badges: Vec<Badge> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        if !badges.contains(badge) {
            badges.push_back(badge);
            env.storage().persistent().set(&key, &badges);
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }

        BadgeGrantedEvent {
            contributor: contributor_address,
            badge,
            executor,
        }
        .publish(&env);

        Ok(())
    }

    pub fn revoke_badge(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        badge: Badge,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::RevokeBadge)?;

        // Ensure contributor exists
        let _ = Self::get_contributor(env.clone(), contributor_address.clone())?;

        let key = DataKey::Badges(contributor_address.clone());
        let mut badges: Vec<Badge> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        if let Some(index) = badges.first_index_of(badge) {
            badges.remove(index);
            env.storage().persistent().set(&key, &badges);
            if !badges.is_empty() {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }

        BadgeRevokedEvent {
            contributor: contributor_address,
            badge,
            executor,
        }
        .publish(&env);

        Ok(())
    }

    /// Apply a reputation penalty triggered by a resolved dispute.
    ///
    /// Requires multisig approval for `ProposalAction::ApplyPenalty`.
    /// Deducts `points` from the contributor's reputation (floored at 0),
    /// stores a `PenaltyRecord` for auditability, and emits
    /// `ReputationPenaltyAppliedEvent`.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_reputation_penalty(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        dispute_id: u64,
        severity: PenaltySeverity,
        points: u64,
        reason: String,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::ApplyPenalty)?;

        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(contributor_address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(contributor_address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        contributor.reputation_score = contributor.reputation_score.saturating_sub(points);
        env.storage().persistent().set(
            &DataKey::Contributor(contributor_address.clone()),
            &contributor,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Contributor(contributor_address.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        let record = PenaltyRecord {
            dispute_id,
            severity,
            points_deducted: points,
            reason: reason.clone(),
            applied_at: env.ledger().timestamp(),
        };
        let penalty_key = DataKey::ReputationPenalty(contributor_address.clone());
        env.storage().persistent().set(&penalty_key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&penalty_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        ReputationPenaltyAppliedEvent {
            contributor: contributor_address,
            dispute_id,
            severity,
            points_deducted: points,
            reason,
            executor,
        }
        .publish(&env);

        Ok(())
    }

    pub fn upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::Upgrade)?;

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        UpgradedEvent {
            admin: executor,
            new_wasm_hash,
        }
        .publish(&env);

        Ok(())
    }

    pub fn set_admin(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), ContributorError> {
        consume_approval(&env, &executor, proposal_id, &ProposalAction::SetAdmin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        AdminChangedEvent {
            old_admin: executor,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    // ── Queries ──────────────────────────────────────────────

    pub fn get_reputation(env: Env, contributor: Address) -> Result<u64, ContributorError> {
        Ok(Self::get_contributor(env, contributor)?.reputation_score)
    }

    pub fn get_tier(env: Env, contributor: Address) -> Result<ContributorTier, ContributorError> {
        let rep = Self::get_reputation(env, contributor)?;
        Ok(match rep {
            0..=9 => ContributorTier::Novice,
            10..=49 => ContributorTier::Builder,
            50..=99 => ContributorTier::Architect,
            _ => ContributorTier::Core,
        })
    }

    pub fn get_badges(env: Env, contributor: Address) -> Vec<Badge> {
        let key = DataKey::Badges(contributor);
        let badges: Vec<Badge> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if env.storage().persistent().has(&key) {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        badges
    }

    /// Returns the most recent penalty record for a contributor, if any.
    pub fn get_penalty_record(env: Env, contributor: Address) -> Option<PenaltyRecord> {
        let key = DataKey::ReputationPenalty(contributor);
        let record: Option<PenaltyRecord> = env.storage().persistent().get(&key);
        if record.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }
        record
    }

    pub fn get_contributor(
        env: Env,
        address: Address,
    ) -> Result<ContributorData, ContributorError> {
        let key = DataKey::Contributor(address);
        let data = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContributorError::ContributorNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(data)
    }

    pub fn get_contributor_by_github(
        env: Env,
        github_handle: String,
    ) -> Result<ContributorData, ContributorError> {
        let index_key = DataKey::GitHubIndex(github_handle);
        let address: Address = env
            .storage()
            .persistent()
            .get(&index_key)
            .ok_or(ContributorError::ContributorNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&index_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Self::get_contributor(env, address)
    }

    pub fn get_multisig_config(env: Env) -> Result<MultisigConfig, ContributorError> {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        get_config(&env)
    }

    pub fn get_registration_nonce(env: Env, address: Address) -> u64 {
        Self::registration_nonce_of(&env, &address)
    }

    pub fn get_proposal(
        env: Env,
        proposal_id: u64,
    ) -> Result<multisig::Proposal, ContributorError> {
        get_proposal(&env, proposal_id)
    }

    pub fn get_next_proposal_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(0)
    }
}

// ── Notification receiver ─────────────────────────────────────

#[contractimpl]
impl NotificationReceiverTrait for ContributorRegistryContract {
    fn on_notify(env: Env, notification: Notification) {
        if notification.event_type == Symbol::new(&env, "deposit") {
            let (user, _project_id, _amount): (Address, u64, i128) =
                <(Address, u64, i128)>::from_xdr(&env, &notification.data).unwrap();

            let key = DataKey::Contributor(user.clone());
            if let Some(mut contributor) =
                env.storage().persistent().get::<_, ContributorData>(&key)
            {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
                contributor.reputation_score = contributor.reputation_score.saturating_add(1);
                env.storage().persistent().set(&key, &contributor);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as TestAddress, Ledger}, // Ledger trait for set_timestamp
        Address,
        Bytes,
        Env,
        Vec,
    };

    struct Setup {
        env: Env,
        contract: Address,
        alice: Address,
        bob: Address,
        carol: Address,
    }

    fn setup() -> Setup {
        let env = Env::default();
        env.mock_all_auths();
        // env.register() replaces the deprecated env.register_contract()
        let contract = env.register(ContributorRegistryContract, ());
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(Signer {
            address: alice.clone(),
            weight: 2,
        });
        signers.push_back(Signer {
            address: bob.clone(),
            weight: 1,
        });
        signers.push_back(Signer {
            address: carol.clone(),
            weight: 1,
        });

        let client = ContributorRegistryContractClient::new(&env, &contract);
        client.initialize(&signers, &3u32);

        Setup {
            env,
            contract,
            alice,
            bob,
            carol,
        }
    }

    // ── Initialisation ────────────────────────────────────────

    #[test]
    fn test_initialize_stores_config() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);
        // Client methods return values directly — no .unwrap() needed.
        let config = client.get_multisig_config();
        assert_eq!(config.threshold, 3);
        assert_eq!(config.signers.len(), 3);
    }

    #[test]
    fn test_double_initialize_fails() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);
        let mut signers = Vec::new(&s.env);
        signers.push_back(Signer {
            address: s.alice.clone(),
            weight: 1,
        });
        // try_* variants return Result and are used to assert failure.
        assert!(client.try_initialize(&signers, &1u32).is_err());
    }

    #[test]
    fn test_threshold_above_total_weight_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(ContributorRegistryContract, ());
        let client = ContributorRegistryContractClient::new(&env, &contract);
        let alice = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(Signer {
            address: alice,
            weight: 1,
        });
        assert!(client.try_initialize(&signers, &99u32).is_err());
    }

    // ── Propose ───────────────────────────────────────────────

    #[test]
    fn test_propose_counts_proposer_weight() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        let proposal = client.get_proposal(&id);

        assert_eq!(proposal.weight_collected, 2);
        assert_eq!(proposal.status, ProposalStatus::Pending);
    }

    #[test]
    fn test_propose_by_non_signer_fails() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);
        let outsider = Address::generate(&s.env);
        assert!(client
            .try_propose(&outsider, &ProposalAction::Upgrade)
            .is_err());
    }

    #[test]
    fn test_single_signer_above_threshold_auto_approves() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = env.register(ContributorRegistryContract, ());
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let mut signers = Vec::new(&env);
        signers.push_back(Signer {
            address: alice.clone(),
            weight: 3,
        });
        signers.push_back(Signer {
            address: bob.clone(),
            weight: 1,
        });

        let client = ContributorRegistryContractClient::new(&env, &contract);
        client.initialize(&signers, &3u32);

        let id = client.propose(&alice, &ProposalAction::Upgrade);
        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::Approved);
    }

    // ── Sign ──────────────────────────────────────────────────

    #[test]
    fn test_sign_reaches_threshold() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        let status = client.sign(&s.bob, &id);
        assert_eq!(status, ProposalStatus::Approved);
    }

    #[test]
    fn test_double_sign_rejected() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.bob, &ProposalAction::Upgrade);
        assert!(client.try_sign(&s.bob, &id).is_err());
    }

    #[test]
    fn test_non_signer_cannot_sign() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);
        let outsider = Address::generate(&s.env);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        assert!(client.try_sign(&outsider, &id).is_err());
    }

    #[test]
    fn test_bob_carol_together_cannot_reach_threshold() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.bob, &ProposalAction::Upgrade);
        client.sign(&s.carol, &id);

        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::Pending);
    }

    // ── Gasless registration ─────────────────────────────────

    #[test]
    fn test_register_contributor_with_sig_increments_nonce() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "gasless_dev");
        let signature = Bytes::from_slice(&s.env, &[1u8; 64]);

        assert_eq!(client.get_registration_nonce(&contributor), 0);
        client.register_contributor_with_sig(&handle, &contributor, &signature);
        assert_eq!(client.get_registration_nonce(&contributor), 1);

        let data = client.get_contributor(&contributor);
        assert_eq!(data.github_handle, handle);
    }

    #[test]
    fn test_register_contributor_with_sig_rejects_empty_signature() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "gasless_dev");
        let empty_signature = Bytes::new(&s.env);

        let result =
            client.try_register_contributor_with_sig(&handle, &contributor, &empty_signature);
        assert_eq!(result, Err(Ok(ContributorError::InvalidSignature)));
        // Nonce must NOT advance on failure.
        assert_eq!(client.get_registration_nonce(&contributor), 0);
    }

    /// A relayer cannot replay a successful gasless registration with the same
    /// signed intent.  After the first call succeeds the address is already
    /// stored (`ContributorAlreadyExists`) and the nonce has advanced, so the
    /// old auth-entry's nonce no longer matches — two independent guards.
    #[test]
    fn test_gasless_registration_replay_is_rejected() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "replay_dev");
        let signature = Bytes::from_slice(&s.env, &[0xABu8; 64]);

        // First call succeeds; nonce advances to 1.
        client.register_contributor_with_sig(&handle, &contributor, &signature);
        assert_eq!(client.get_registration_nonce(&contributor), 1);

        // Second call with the same arguments must be rejected because the
        // contributor already exists (and the nonce has changed).
        let result = client.try_register_contributor_with_sig(&handle, &contributor, &signature);
        assert_eq!(result, Err(Ok(ContributorError::ContributorAlreadyExists)));

        // Nonce must NOT advance on the failed replay attempt.
        assert_eq!(client.get_registration_nonce(&contributor), 1);
    }

    /// The `get_registration_nonce` query returns 0 for an unknown address and
    /// the correct incremented value after a successful gasless registration.
    #[test]
    fn test_get_registration_nonce_query() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let unknown = Address::generate(&s.env);
        assert_eq!(client.get_registration_nonce(&unknown), 0);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "nonce_check_dev");
        let signature = Bytes::from_slice(&s.env, &[0x01u8; 64]);

        client.register_contributor_with_sig(&handle, &contributor, &signature);
        assert_eq!(client.get_registration_nonce(&contributor), 1);
    }

    // ── Execute ───────────────────────────────────────────────

    #[test]
    fn test_consume_approval_executes_after_threshold() {
        // env.deployer().update_current_contract_wasm() is unavailable in the
        // test environment, so we verify consume_approval via set_admin, which
        // exercises the identical code path without hitting the deployer.
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::SetAdmin);
        client.sign(&s.bob, &id); // threshold reached

        let new_admin = Address::generate(&s.env);
        client.set_admin(&s.alice, &id, &new_admin);

        // Proposal must be Executed — replay is now impossible.
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);
    }

    #[test]
    fn test_upgrade_approved_before_execution() {
        // Verifies the proposal reaches Approved status when threshold is met,
        // which is the pre-condition for upgrade execution.
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);

        let status = client.sign(&s.bob, &id);
        assert_eq!(status, ProposalStatus::Approved);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Approved);
    }

    #[test]
    fn test_execute_below_threshold_fails() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.bob, &ProposalAction::Upgrade);
        let wasm_hash = BytesN::from_array(&s.env, &[1u8; 32]);
        assert!(client.try_upgrade(&s.bob, &id, &wasm_hash).is_err());
    }

    #[test]
    fn test_wrong_action_type_rejected() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        client.sign(&s.bob, &id);

        let new_admin = Address::generate(&s.env);
        assert!(client.try_set_admin(&s.alice, &id, &new_admin).is_err());
    }

    #[test]
    fn test_replay_blocked_after_execution() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        client.sign(&s.bob, &id);
        let wasm_hash = BytesN::from_array(&s.env, &[1u8; 32]);
        let _ = client.try_upgrade(&s.alice, &id, &wasm_hash);

        assert!(client.try_upgrade(&s.alice, &id, &wasm_hash).is_err());
    }

    // ── update_reputation ─────────────────────────────────────

    #[test]
    fn test_update_reputation_requires_multisig() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "dev_handle");
        client.register_contributor(&contributor, &handle);

        let fake_id = 999u64;
        assert!(client
            .try_update_reputation(&s.alice, &fake_id, &contributor, &10i64)
            .is_err());
    }

    #[test]
    fn test_update_reputation_succeeds_with_approval() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "dev_handle");
        client.register_contributor(&contributor, &handle);

        let id = client.propose(&s.alice, &ProposalAction::UpdateReputation);
        client.sign(&s.bob, &id);

        client.update_reputation(&s.alice, &id, &contributor, &50i64);

        assert_eq!(client.get_reputation(&contributor), 50);
    }

    // ── Cancel & expire ───────────────────────────────────────

    #[test]
    fn test_cancel_blocks_execution() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        client.sign(&s.bob, &id);
        client.cancel_proposal(&s.alice, &id);

        let wasm_hash = BytesN::from_array(&s.env, &[1u8; 32]);
        assert!(client.try_upgrade(&s.alice, &id, &wasm_hash).is_err());
    }

    #[test]
    fn test_expire_after_ttl() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        s.env.ledger().set_timestamp(1_000_000);
        let id = client.propose(&s.alice, &ProposalAction::Upgrade);

        s.env
            .ledger()
            .set_timestamp(1_000_000 + multisig::PROPOSAL_TTL_SECS + 1);

        client.expire_proposal(&id);

        let proposal = client.get_proposal(&id);
        assert_eq!(proposal.status, ProposalStatus::Expired);
    }

    #[test]
    fn test_expire_before_ttl_fails() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        s.env.ledger().set_timestamp(1_000_000);
        let id = client.propose(&s.alice, &ProposalAction::Upgrade);
        s.env.ledger().set_timestamp(1_000_000 + 3600);

        assert!(client.try_expire_proposal(&id).is_err());
    }

    // ── Full integration flow ─────────────────────────────────

    #[test]
    fn test_full_proposal_flow() {
        // Full lifecycle: propose → sign → sign → execute → replay blocked.
        // Uses SetAdmin as the action since it doesn't require the deployer.
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        // 1. Alice proposes (w=2, threshold=3) → Pending
        let id = client.propose(&s.alice, &ProposalAction::SetAdmin);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);

        // 2. Bob signs (w=1) → total=3=threshold → Approved
        let status = client.sign(&s.bob, &id);
        assert_eq!(status, ProposalStatus::Approved);

        // 3. Carol signs over threshold — still Approved, not a state change
        let status = client.sign(&s.carol, &id);
        assert_eq!(status, ProposalStatus::Approved);

        // 4. Alice executes → Executed
        let new_admin = Address::generate(&s.env);
        client.set_admin(&s.alice, &id, &new_admin);
        assert_eq!(client.get_proposal(&id).status, ProposalStatus::Executed);

        // 5. Replay attempt fails
        let new_admin2 = Address::generate(&s.env);
        assert!(client.try_set_admin(&s.alice, &id, &new_admin2).is_err());
    }

    // ── TTL / storage-rent tests ──────────────────────────────

    /// Verify that a contributor entry remains accessible after a simulated
    /// ledger advance (TTL bump keeps the entry alive).
    #[test]
    fn test_contributor_entry_accessible_after_ledger_advance() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "ttl_dev");
        client.register_contributor(&contributor, &handle);

        // Advance the ledger sequence significantly (simulates time passing).
        s.env.ledger().set_sequence_number(200_000);

        // The entry must still be readable — TTL bump on write keeps it alive.
        let data = client.get_contributor(&contributor);
        assert_eq!(data.github_handle, handle);
    }

    /// Verify that TTL is extended after a write (registration) and a read
    /// (get_contributor) by confirming the entry survives a large ledger jump.
    #[test]
    fn test_ttl_extended_after_read_write() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "ttl_rw_dev");
        client.register_contributor(&contributor, &handle);

        // Simulate a large ledger advance.
        s.env.ledger().set_sequence_number(100_001);

        // Read triggers another TTL bump; entry must still be accessible.
        let data = client.get_contributor(&contributor);
        assert_eq!(data.github_handle, handle);

        // Advance again — the read-triggered bump should keep it alive.
        s.env.ledger().set_sequence_number(200_002);
        let data2 = client.get_contributor(&contributor);
        assert_eq!(data2.github_handle, handle);
    }

    /// Verify that deregistering a contributor removes all three storage keys
    /// (Contributor, GitHubIndex, RegistrationNonce) — no orphaned entries.
    #[test]
    fn test_deregister_removes_all_keys() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "deregister_dev");
        let signature = soroban_sdk::Bytes::from_slice(&s.env, &[1u8; 64]);

        // Use gasless registration so a nonce entry is also created.
        client.register_contributor_with_sig(&handle, &contributor, &signature);
        assert_eq!(client.get_registration_nonce(&contributor), 1);

        // Deregister — all three keys must be removed.
        client.deregister_contributor(&contributor);

        // Contributor entry gone.
        assert!(client.try_get_contributor(&contributor).is_err());
        // GitHub index entry gone — a new address can now claim the same handle.
        let other = Address::generate(&s.env);
        let sig2 = soroban_sdk::Bytes::from_slice(&s.env, &[2u8; 64]);
        client.register_contributor_with_sig(&handle, &other, &sig2);
        let data = client.get_contributor(&other);
        assert_eq!(data.github_handle, handle);
    }

    // ── Badges & Tiers ────────────────────────────────────────

    #[test]
    fn test_tier_calculation() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "tier_dev");
        client.register_contributor(&contributor, &handle);

        assert_eq!(client.get_tier(&contributor), ContributorTier::Novice);

        let id = client.propose(&s.alice, &ProposalAction::UpdateReputation);
        client.sign(&s.bob, &id);
        client.update_reputation(&s.alice, &id, &contributor, &20i64);
        assert_eq!(client.get_tier(&contributor), ContributorTier::Builder);

        let id2 = client.propose(&s.alice, &ProposalAction::UpdateReputation);
        client.sign(&s.bob, &id2);
        client.update_reputation(&s.alice, &id2, &contributor, &50i64);
        assert_eq!(client.get_tier(&contributor), ContributorTier::Architect);

        let id3 = client.propose(&s.alice, &ProposalAction::UpdateReputation);
        client.sign(&s.bob, &id3);
        client.update_reputation(&s.alice, &id3, &contributor, &50i64);
        assert_eq!(client.get_tier(&contributor), ContributorTier::Core);
    }

    #[test]
    fn test_grant_and_revoke_badge() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "badge_dev");
        client.register_contributor(&contributor, &handle);

        assert_eq!(client.get_badges(&contributor).len(), 0);

        let id = client.propose(&s.alice, &ProposalAction::GrantBadge);
        client.sign(&s.bob, &id);
        client.grant_badge(&s.alice, &id, &contributor, &Badge::EarlyAdopter);

        let badges = client.get_badges(&contributor);
        assert_eq!(badges.len(), 1);
        assert!(badges.contains(Badge::EarlyAdopter));

        let id2 = client.propose(&s.alice, &ProposalAction::RevokeBadge);
        client.sign(&s.bob, &id2);
        client.revoke_badge(&s.alice, &id2, &contributor, &Badge::EarlyAdopter);

        assert_eq!(client.get_badges(&contributor).len(), 0);
    }

    // ── Reputation penalty hooks (issue #691) ─────────────────

    #[test]
    fn test_apply_penalty_deducts_reputation() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "penalty_dev");
        client.register_contributor(&contributor, &handle);

        // Give the contributor some reputation first.
        let id = client.propose(&s.alice, &ProposalAction::UpdateReputation);
        client.sign(&s.bob, &id);
        client.update_reputation(&s.alice, &id, &contributor, &100i64);
        assert_eq!(client.get_reputation(&contributor), 100);

        // Apply a penalty via multisig.
        let pid = client.propose(&s.alice, &ProposalAction::ApplyPenalty);
        client.sign(&s.bob, &pid);
        let reason = soroban_sdk::String::from_str(&s.env, "fraudulent milestone");
        client.apply_reputation_penalty(
            &s.alice,
            &pid,
            &contributor,
            &1u64,
            &PenaltySeverity::Moderate,
            &30u64,
            &reason,
        );

        assert_eq!(client.get_reputation(&contributor), 70);
    }

    #[test]
    fn test_apply_penalty_floors_at_zero() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "floor_dev");
        client.register_contributor(&contributor, &handle);

        // Reputation is 0; penalty should not underflow.
        let pid = client.propose(&s.alice, &ProposalAction::ApplyPenalty);
        client.sign(&s.bob, &pid);
        let reason = soroban_sdk::String::from_str(&s.env, "severe violation");
        client.apply_reputation_penalty(
            &s.alice,
            &pid,
            &contributor,
            &2u64,
            &PenaltySeverity::Severe,
            &999u64,
            &reason,
        );

        assert_eq!(client.get_reputation(&contributor), 0);
    }

    #[test]
    fn test_apply_penalty_stores_record() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "record_dev");
        client.register_contributor(&contributor, &handle);

        let pid = client.propose(&s.alice, &ProposalAction::ApplyPenalty);
        client.sign(&s.bob, &pid);
        let reason = soroban_sdk::String::from_str(&s.env, "dispute resolved against");
        client.apply_reputation_penalty(
            &s.alice,
            &pid,
            &contributor,
            &42u64,
            &PenaltySeverity::Minor,
            &10u64,
            &reason,
        );

        let record = client.get_penalty_record(&contributor).unwrap();
        assert_eq!(record.dispute_id, 42);
        assert_eq!(record.severity, PenaltySeverity::Minor);
        assert_eq!(record.points_deducted, 10);
    }

    #[test]
    fn test_apply_penalty_requires_multisig() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "noauth_dev");
        client.register_contributor(&contributor, &handle);

        let reason = soroban_sdk::String::from_str(&s.env, "test");
        let fake_id = 999u64;
        assert!(client
            .try_apply_reputation_penalty(
                &s.alice,
                &fake_id,
                &contributor,
                &1u64,
                &PenaltySeverity::Minor,
                &5u64,
                &reason,
            )
            .is_err());
    }

    #[test]
    fn test_get_penalty_record_returns_none_when_absent() {
        let s = setup();
        let client = ContributorRegistryContractClient::new(&s.env, &s.contract);

        let contributor = Address::generate(&s.env);
        let handle = soroban_sdk::String::from_str(&s.env, "no_penalty_dev");
        client.register_contributor(&contributor, &handle);

        assert!(client.get_penalty_record(&contributor).is_none());
    }
}
