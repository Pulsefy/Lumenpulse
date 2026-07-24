#![no_std]

mod errors;
mod events;
mod storage;

use errors::ContributorError;
use events::{
    AdminChangedEvent, BadgeGrantedEvent, BadgeRevokedEvent, ContributorProfileChangedEvt,
    GaslessRegistrationEvent, MultisigConfiguredEvent, ReputationPenaltyAppliedEvent,
    UpgradedEvent,
};
use multisig_guard::{
    cancel as multisig_cancel, configure as multisig_configure, consume_approval,
    expire as multisig_expire, get_config as multisig_get_config, get_proposal,
    propose as multisig_propose, replace_config as multisig_replace_config, sign as multisig_sign,
    MultisigConfig, MultisigDataKey, Proposal, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};
use notification_interface::{Notification, NotificationReceiverTrait};
use soroban_sdk::xdr::FromXdr;
use soroban_sdk::{
    contract, contractimpl, vec, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, Vec,
};
use storage::{
    Badge, ContributorData, ContributorTier, DataKey, PenaltyRecord, PenaltySeverity, ProposalAction, LEDGER_BUMP,
    LEDGER_THRESHOLD,
};

pub use storage::ProposalAction as ContributorProposalAction;

#[contract]
pub struct ContributorRegistryContract;

#[contractimpl]
impl ContributorRegistryContract {
    // ── Helpers ──────────────────────────────────────────────

    fn ensure_initialized(env: &Env) -> Result<(), ContributorError> {
        if !env.storage().instance().has(&DataKey::Admin) {
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

    pub fn initialize(env: Env, admin: Address) -> Result<(), ContributorError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContributorError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);

        Ok(())
    }

    pub fn configure_multisig(
        env: Env,
        signers: Vec<Signer>,
        threshold: u32,
    ) -> Result<(), ContributorError> {
        multisig_configure(&env, signers.clone(), threshold).map_err(|_| ContributorError::Unauthorized)?;
        let signer_count = signers.len();
        let bootstrapper = signers.get(0).ok_or(ContributorError::InvalidMultisigConfig)?;
        events::MultisigConfiguredEvent {
            configured_by: bootstrapper.address.clone(),
            threshold,
            signer_count,
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
        let payload = vec![&env, action.into_val(&env)];
        multisig_propose(&env, proposer, payload).map_err(|_| ContributorError::Unauthorized)
    }

    pub fn sign_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), ContributorError> {
        multisig_sign(&env, signer, proposal_id).map_err(|_| ContributorError::Unauthorized)?;
        Ok(())
    }

    pub fn cancel_proposal(
        env: Env,
        signer: Address,
        proposal_id: u64,
    ) -> Result<(), ContributorError> {
        multisig_cancel(&env, signer, proposal_id).map_err(|_| ContributorError::Unauthorized)
    }

    pub fn expire_proposal(env: Env, proposal_id: u64) -> Result<(), ContributorError> {
        multisig_expire(&env, proposal_id).map_err(|_| ContributorError::Unauthorized)
    }

    pub fn set_multisig_config_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_signers: Vec<Signer>,
        new_threshold: u32,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::SetMultisigConfig(new_signers.clone(), new_threshold).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| ContributorError::Unauthorized)?;

        multisig_replace_config(&env, new_signers.clone(), new_threshold).map_err(|_| ContributorError::InvalidMultisigConfig)?;

        MultisigConfiguredEvent {
            configured_by: executor,
            threshold: new_threshold,
            signer_count: new_signers.len(),
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

        let nonce = Self::registration_nonce_of(&env, &address);

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

    pub fn deregister_contributor(env: Env, address: Address) -> Result<(), ContributorError> {
        Self::ensure_initialized(&env)?;
        address.require_auth();

        let contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;

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

    pub fn update_contributor(
        env: Env,
        actor: Address,
        address: Address,
        github_handle: String,
        proposal_id: Option<u64>,
    ) -> Result<(), ContributorError> {
        Self::ensure_initialized(&env)?;

        if github_handle.is_empty() {
            return Err(ContributorError::InvalidGitHubHandle);
        }

        let contributor: ContributorData = env
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

        match proposal_id {
            None => {
                actor.require_auth();
                if actor != address {
                    return Err(ContributorError::Unauthorized);
                }
            }
            Some(pid) => {
                let expected_payload = vec![&env, ProposalAction::UpdateProfile(address.clone(), github_handle.clone()).into_val(&env)];
                consume_approval(&env, &actor, pid, &expected_payload).map_err(|_| ContributorError::Unauthorized)?;
            }
        }

        let old_handle = contributor.github_handle.clone();

        if old_handle != github_handle {
            let mut contributor = contributor;
            contributor.github_handle = github_handle.clone();
            env.storage()
                .persistent()
                .remove(&DataKey::GitHubIndex(old_handle.clone()));
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
                &DataKey::GitHubIndex(github_handle.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
        }

        ContributorProfileChangedEvt {
            contributor: address,
            actor,
            new_github_handle: github_handle,
            proposal_id: proposal_id.unwrap_or(0),
        }
        .publish(&env);

        Ok(())
    }

    // ── Sensitive functions — multisig-gated ─────────────────

    pub fn update_reputation_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        delta: u64,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::UpdateReputation(contributor_address.clone(), delta).into_val(&env)];
        consume_approval(
            &env,
            &executor,
            proposal_id,
            &expected_payload,
        ).map_err(|_| ContributorError::Unauthorized)?;

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

        let new_score = contributor
            .reputation_score
            .checked_add(delta)
            .ok_or(ContributorError::ReputationOverflow)?;
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

    pub fn grant_badge_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        badge: Badge,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::IssueBadge(contributor_address.clone(), badge.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| ContributorError::Unauthorized)?;

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

    pub fn revoke_badge_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        badge: Badge,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::RevokeBadge(contributor_address.clone(), badge.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| ContributorError::Unauthorized)?;

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

    pub fn apply_reputation_penalty_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        contributor_address: Address,
        dispute_id: u64,
        severity: PenaltySeverity,
        points: u64,
        reason: String,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::ApplyPenalty(contributor_address.clone(), dispute_id, severity, points, reason.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| ContributorError::Unauthorized)?;

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

    pub fn set_admin_via_multisig(
        env: Env,
        executor: Address,
        proposal_id: u64,
        new_admin: Address,
    ) -> Result<(), ContributorError> {
        let expected_payload = vec![&env, ProposalAction::SetAdmin(new_admin.clone()).into_val(&env)];
        consume_approval(&env, &executor, proposal_id, &expected_payload)
            .map_err(|_| ContributorError::Unauthorized)?;

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
        multisig_get_config(&env).map_err(|_| ContributorError::NotInitialized)
    }

    pub fn get_registration_nonce(env: Env, address: Address) -> u64 {
        Self::registration_nonce_of(&env, &address)
    }

    pub fn get_proposal(
        env: Env,
        proposal_id: u64,
    ) -> Result<Proposal, ContributorError> {
        get_proposal(&env, proposal_id).map_err(|_| ContributorError::Unauthorized)
    }

    pub fn get_next_proposal_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage()
            .instance()
            .get(&MultisigDataKey::NextProposalId)
            .unwrap_or(0)
    }
}

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

#[cfg(test)]
mod test;
