import {
  CanonicalEventType,
  getCategory,
  EventCategory,
} from '../common/event-catalog';

// Keyed by the Soroban event's first topic — for every contract event in
// this workspace defined via `#[contractevent]` without an explicit
// `#[topics(...)]` override, `soroban-sdk`'s derive macro auto-generates
// that topic as `heck::ToSnakeCase` of the Rust struct name (e.g. the
// struct `ProjectCreatedEvent` publishes topic `project_created_event`,
// not the PascalCase struct name itself — confirmed against the derive
// macro source and against real event XDR captured in contract test
// snapshots). Keying this map by the PascalCase struct name, as an
// earlier version of this file did, meant NOTHING here ever matched a
// real on-chain topic (see issue #1231).
//
// The snake_case topic is also where Soroban's 32-char `ScSymbol` limit
// actually bites: it's checked against the snake_cased string (which is
// longer than the struct name once underscores are inserted), not the
// struct name itself — this is why `ContributorProfileChangedEvent`
// (30-char struct name, but a 33-char snake_case topic) fails to compile
// while the shorter `ContributorProfileChangedEvt` succeeds.
//
// Several structs share a name across contracts (e.g. `AdminChangedEvent`,
// `UpgradedEvent`, `PoolInitializedEvent`) — that's intentional: they
// represent the same canonical concept, and the emitting contract address
// (`contractId`, captured separately by the indexer) disambiguates which
// contract fired it. Do not key this map by a symbol a contract doesn't
// actually publish (see issue #1231 — a prior `CURATION_EVENT_MAP` here
// assumed `lumenpulse-curation` used short symbol topics like
// `proposed`/`voted`; it never did, so those events were silently
// unmapped since they were introduced).
const RAW_EVENT_MAP: Record<string, CanonicalEventType> = {
  initialized_event: CanonicalEventType.ADMIN_STORAGE_MIGRATED,
  project_created_event: CanonicalEventType.PROJECT_CREATED,
  deposit_event: CanonicalEventType.CONTRIBUTION_DEPOSITED,
  milestone_approved_event: CanonicalEventType.MILESTONE_APPROVED,
  milestone_decision_event: CanonicalEventType.MILESTONE_DECISION_RECORDED,
  withdraw_event: CanonicalEventType.CONTRIBUTION_PAID_OUT,
  contributor_registered_event: CanonicalEventType.REPUTATION_UPDATED,
  reputation_updated_event: CanonicalEventType.REPUTATION_UPDATED,
  contract_pause_event: CanonicalEventType.ADMIN_PAUSED,
  contract_unpause_event: CanonicalEventType.ADMIN_UNPAUSED,
  upgraded_event: CanonicalEventType.ADMIN_UPGRADED,
  admin_changed_event: CanonicalEventType.ADMIN_CHANGED,
  project_canceled_event: CanonicalEventType.PROJECT_CANCELED,
  contribution_refunded_event: CanonicalEventType.CONTRIBUTION_REFUNDED,
  contributor_payout_event: CanonicalEventType.CONTRIBUTION_PAID_OUT,
  project_expired_event: CanonicalEventType.PROJECT_EXPIRED,
  contribution_clawed_back_event: CanonicalEventType.CONTRIBUTION_CLAWED_BACK,
  protocol_fee_deducted_event: CanonicalEventType.FEE_DEDUCTED,
  milestone_vote_started_event: CanonicalEventType.MILESTONE_VOTE_STARTED,
  fee_config_changed_event: CanonicalEventType.ADMIN_FEE_CONFIG_CHANGED,
  config_updated_event: CanonicalEventType.ADMIN_CONFIG_UPDATED,
  vote_cast_event: CanonicalEventType.MILESTONE_VOTE_CAST,
  milestone_approved_by_vote_event: CanonicalEventType.MILESTONE_APPROVED_BY_VOTE,
  milestone_disputed_event: CanonicalEventType.MILESTONE_DISPUTED,
  milestone_dispute_resolved_event: CanonicalEventType.MILESTONE_DISPUTE_RESOLVED,
  storage_migrated_event: CanonicalEventType.ADMIN_STORAGE_MIGRATED,
  round_created_event: CanonicalEventType.POOL_ROUND_CREATED,
  pool_funded_event: CanonicalEventType.POOL_FUNDED,
  reward_pool_funded_event: CanonicalEventType.POOL_REWARD_FUNDED,
  project_approved_event: CanonicalEventType.POOL_PROJECT_APPROVED,
  project_removed_event: CanonicalEventType.POOL_PROJECT_REMOVED,
  contribution_recorded_event: CanonicalEventType.POOL_CONTRIBUTION_RECORDED,
  round_finalized_event: CanonicalEventType.POOL_ROUND_FINALIZED,
  round_cap_updated_event: CanonicalEventType.POOL_ROUND_CAP_UPDATED,
  match_distributed_event: CanonicalEventType.POOL_MATCH_DISTRIBUTED,
  all_matches_distributed_event: CanonicalEventType.POOL_ALL_MATCHES_DISTRIBUTED,
  pool_initialized_event: CanonicalEventType.LIQUIDITY_POOL_INITIALIZED,
  liquidity_added_event: CanonicalEventType.LIQUIDITY_ADDED,
  liquidity_removed_event: CanonicalEventType.LIQUIDITY_REMOVED,
  swap_event: CanonicalEventType.LIQUIDITY_SWAPPED,
  burn_event: CanonicalEventType.TOKEN_BURNED,
  mint_event: CanonicalEventType.TOKEN_MINTED,
  transfer_event: CanonicalEventType.TOKEN_TRANSFERRED,
  allowance_changed_event: CanonicalEventType.TOKEN_ALLOWANCE_CHANGED,
  account_state_changed_event: CanonicalEventType.TOKEN_ACCOUNT_STATE_CHANGED,
  vesting_created_event: CanonicalEventType.TOKEN_VESTING_CREATED,
  tokens_claimed_event: CanonicalEventType.TOKEN_CLAIMED,
  stream_created_event: CanonicalEventType.TOKEN_STREAM_CREATED,
  cliff_stream_created_event: CanonicalEventType.TOKEN_STREAM_CREATED,
  beneficiary_rotated_event: CanonicalEventType.TOKEN_STREAM_BENEFICIARY_ROTATED,
  stream_cancelled_event: CanonicalEventType.TOKEN_STREAM_CANCELLED,
  delegate_approved_event: CanonicalEventType.TOKEN_DELEGATE_APPROVED,
  delegate_revoked_event: CanonicalEventType.TOKEN_DELEGATE_REVOKED,
  delegated_claim_event: CanonicalEventType.TOKEN_DELEGATED_CLAIM,
  price_updated_event: CanonicalEventType.PRICE_UPDATED,
  oracle_updated_event: CanonicalEventType.PRICE_ORACLE_UPDATED,
  price_invalidated_event: CanonicalEventType.PRICE_INVALIDATED,
  staleness_window_updated_event:
    CanonicalEventType.PRICE_STALENESS_WINDOW_UPDATED,
  proposal_created_event: CanonicalEventType.GOVERNANCE_PROPOSAL_CREATED,
  signature_collected_event: CanonicalEventType.GOVERNANCE_SIGNATURE_COLLECTED,
  proposal_executed_event: CanonicalEventType.GOVERNANCE_PROPOSAL_EXECUTED,
  proposal_cancelled_event: CanonicalEventType.GOVERNANCE_PROPOSAL_CANCELLED,
  proposal_expired_event: CanonicalEventType.GOVERNANCE_PROPOSAL_EXPIRED,
  multisig_configured_event: CanonicalEventType.GOVERNANCE_MULTISIG_CONFIGURED,
  gasless_registration_event: CanonicalEventType.REPUTATION_UPDATED,
  badge_granted_event: CanonicalEventType.REPUTATION_BADGE_GRANTED,
  badge_revoked_event: CanonicalEventType.REPUTATION_BADGE_REVOKED,
  reputation_penalty_applied_event: CanonicalEventType.REPUTATION_PENALTY_APPLIED,
  contributor_profile_changed_evt: CanonicalEventType.REPUTATION_PROFILE_CHANGED,
  contributor_deregistered_event:
    CanonicalEventType.REPUTATION_CONTRIBUTOR_DEREGISTERED,
  attestation_suspended_event:
    CanonicalEventType.REPUTATION_ATTESTATION_SUSPENDED,
  attestation_revoked_event: CanonicalEventType.REPUTATION_ATTESTATION_REVOKED,
  attestation_restored_event: CanonicalEventType.REPUTATION_ATTESTATION_RESTORED,
  module_registered_event: CanonicalEventType.MODULE_REGISTERED,
  module_updated_event: CanonicalEventType.MODULE_UPDATED,
  module_deactivated_event: CanonicalEventType.MODULE_DEACTIVATED,
  module_activated_event: CanonicalEventType.MODULE_ACTIVATED,
  module_admin_transferred_event: CanonicalEventType.ADMIN_TRANSFERRED,
  admin_transferred_event: CanonicalEventType.ADMIN_TRANSFERRED,
  admin_rotation_proposed_event: CanonicalEventType.ADMIN_ROTATION_PROPOSED,
  admin_rotation_cancelled_event: CanonicalEventType.ADMIN_ROTATION_CANCELLED,
  scope_pause_changed_event: CanonicalEventType.ADMIN_SCOPE_PAUSE_CHANGED,
  flag_set_event: CanonicalEventType.ADMIN_FEATURE_FLAG_SET,
  operation_queued_event: CanonicalEventType.ADMIN_OPERATION_QUEUED,
  operation_cancelled_event: CanonicalEventType.ADMIN_OPERATION_CANCELLED,
  operation_executed_event: CanonicalEventType.ADMIN_OPERATION_EXECUTED,
  emergency_stop_event: CanonicalEventType.ADMIN_EMERGENCY_STOP,
  project_registered_event: CanonicalEventType.PROJECT_CREATED,
  project_proposed_event: CanonicalEventType.PROJECT_PROPOSED,
  project_verified_event: CanonicalEventType.PROJECT_VERIFIED,
  project_rejected_event: CanonicalEventType.PROJECT_REJECTED,
  project_archived_event: CanonicalEventType.PROJECT_ARCHIVED,
  project_delisted_event: CanonicalEventType.PROJECT_DELISTED,
  verification_overridden_event: CanonicalEventType.ADMIN_VERIFICATION_OVERRIDDEN,
  subscriber_changed_event: CanonicalEventType.CONTRIBUTION_SUBSCRIBER_CHANGED,
  treasury_allocated_event: CanonicalEventType.CONTRIBUTION_ALLOCATED_TO_TREASURY,
  emrg_migr_proposed_event:
    CanonicalEventType.CONTRIBUTION_EMERGENCY_MIGRATION_PROPOSED,
  emrg_migr_executed_event:
    CanonicalEventType.CONTRIBUTION_EMERGENCY_MIGRATION_EXECUTED,
  emergency_migration_vetoed_event:
    CanonicalEventType.CONTRIBUTION_EMERGENCY_MIGRATION_VETOED,
  yield_provider_set_event: CanonicalEventType.CONTRIBUTION_YIELD_PROVIDER_SET,
  yield_invested_event: CanonicalEventType.CONTRIBUTION_YIELD_INVESTED,
  yield_divested_event: CanonicalEventType.CONTRIBUTION_YIELD_DIVESTED,
};

export interface CanonicalMapping {
  canonicalType: CanonicalEventType;
  category: EventCategory;
}

export function mapSorobanEvent(
  eventType: string | null,
): CanonicalMapping | null {
  if (!eventType) return null;

  const mapped = RAW_EVENT_MAP[eventType];
  if (!mapped) return null;

  return { canonicalType: mapped, category: getCategory(mapped) };
}
