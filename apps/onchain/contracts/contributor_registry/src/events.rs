use soroban_sdk::{contractevent, Address, BytesN, String};

use crate::multisig::{ProposalAction, ProposalStatus};
use crate::storage::{Badge, PenaltySeverity};

#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct ProposalCreatedEvent {
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: ProposalAction,
    pub weight_collected: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct SignatureCollectedEvent {
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
    pub weight_collected: u32,
    pub threshold: u32,
    pub status: ProposalStatus,
}

#[contractevent]
pub struct ProposalExecutedEvent {
    #[topic]
    pub proposal_id: u64,
    pub executor: Address,
    pub action: ProposalAction,
}

#[contractevent]
pub struct ProposalCancelledEvent {
    #[topic]
    pub proposal_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
pub struct MultisigConfiguredEvent {
    #[topic]
    pub configured_by: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

/// Emitted when a contributor is registered via a gasless (relayer-submitted)
/// meta-transaction.  Relayers and indexers can use this to track gasless
/// registrations separately from direct ones.
#[contractevent]
pub struct GaslessRegistrationEvent {
    #[topic]
    pub contributor: Address,
    pub github_handle: String,
    /// The nonce that was consumed by this registration.  The next valid nonce
    /// for this address is `consumed_nonce + 1`.
    pub consumed_nonce: u64,
}

#[contractevent]
pub struct BadgeGrantedEvent {
    #[topic]
    pub contributor: Address,
    pub badge: Badge,
    pub executor: Address,
}

#[contractevent]
pub struct BadgeRevokedEvent {
    #[topic]
    pub contributor: Address,
    pub badge: Badge,
    pub executor: Address,
}

#[contractevent]
pub struct ReputationPenaltyAppliedEvent {
    #[topic]
    pub contributor: Address,
    pub dispute_id: u64,
    pub severity: PenaltySeverity,
    pub points_deducted: u64,
    pub reason: String,
    pub executor: Address,
}

/// Emitted whenever a contributor's profile (currently `github_handle`) is
/// mutated. Both self-service updates and admin-managed (multisig) updates
/// emit this event so indexers can reconstruct the audit trail.
///
/// `proposal_id == 0` indicates a self-service update; a non-zero value
/// indicates an admin-managed update via the multisig of that proposal.
// NOTE: kept as `...Evt` (not `...Event`) — Soroban's `#[contractevent]`
// macro panics at compile time on struct names past ~29 chars (confirmed
// empirically under issue #1231); `ContributorProfileChangedEvent` (30
// chars) fails where this 28-char name succeeds.
#[contractevent]
pub struct ContributorProfileChangedEvt {
    #[topic]
    pub contributor: Address,
    /// Address that submitted the transaction. For admin updates this is the
    /// multisig executor; for self updates this equals `contributor`.
    pub actor: Address,
    /// New handle after the mutation.
    pub new_github_handle: String,
    /// Proposal id when the change was admin-managed; 0 for self-service.
    pub proposal_id: u64,
}

/// Emitted when a contributor's attestation is suspended via multisig.
#[contractevent]
pub struct AttestationSuspendedEvent {
    #[topic]
    pub contributor: Address,
    pub executor: Address,
    pub proposal_id: u64,
}

/// Emitted when a contributor's attestation is revoked via multisig.
/// Revocation is terminal — there is no corresponding "un-revoke" event.
#[contractevent]
pub struct AttestationRevokedEvent {
    #[topic]
    pub contributor: Address,
    pub executor: Address,
    pub proposal_id: u64,
}

/// Emitted when a previously suspended attestation is restored to `Active`.
#[contractevent]
pub struct AttestationRestoredEvent {
    #[topic]
    pub contributor: Address,
    pub executor: Address,
    pub proposal_id: u64,
}

/// Emitted when a stale proposal is cleared via `expire_proposal`.
#[contractevent]
pub struct ProposalExpiredEvent {
    #[topic]
    pub proposal_id: u64,
    pub expired_at: u64,
}

/// Emitted when a new contributor registers directly (non-gasless path).
/// Reuses the same struct name `crowdfund_vault` uses for its own
/// contributor registration, since both represent the same canonical event.
#[contractevent]
pub struct ContributorRegisteredEvent {
    #[topic]
    pub contributor: Address,
}

/// Emitted when a contributor removes their own registration, freeing their
/// GitHub handle for reuse by someone else.
#[contractevent]
pub struct ContributorDeregisteredEvent {
    #[topic]
    pub contributor: Address,
    pub freed_github_handle: String,
}

/// Emitted when a contributor's reputation score is adjusted via
/// `update_reputation`.
#[contractevent]
pub struct ReputationUpdatedEvent {
    #[topic]
    pub contributor: Address,
    pub old_reputation: u64,
    pub new_reputation: u64,
}

/// Emitted whenever the pause state of a specific scope changes.
///
/// `scope` identifies which subsystem was affected:
///  - `1` → Contribution (register_contributor, gasless_register)
///  - `2` → Governance (multisig proposals, admin-gated mutations)
///
/// `paused` is the **new** state after the call.
#[contractevent]
pub struct ScopePauseChangedEvent {
    #[topic]
    pub admin: Address,
    /// Numeric discriminant of `ContribPauseScope`.
    pub scope: u32,
    /// `true` = scope is now paused; `false` = scope is now unpaused.
    pub paused: bool,
    pub timestamp: u64,
}
