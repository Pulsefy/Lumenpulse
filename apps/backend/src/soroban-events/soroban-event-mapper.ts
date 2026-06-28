import { CanonicalEventType, getCategory, EventCategory } from '../common/event-catalog';

const RAW_EVENT_MAP: Record<string, CanonicalEventType> = {
  InitializedEvent: CanonicalEventType.ADMIN_STORAGE_MIGRATED,
  ProjectCreatedEvent: CanonicalEventType.PROJECT_CREATED,
  DepositEvent: CanonicalEventType.CONTRIBUTION_DEPOSITED,
  MilestoneApprovedEvent: CanonicalEventType.MILESTONE_APPROVED,
  WithdrawEvent: CanonicalEventType.CONTRIBUTION_PAID_OUT,
  ContributorRegisteredEvent: CanonicalEventType.REPUTATION_UPDATED,
  ReputationUpdatedEvent: CanonicalEventType.REPUTATION_UPDATED,
  ContractPauseEvent: CanonicalEventType.ADMIN_PAUSED,
  ContractUnpauseEvent: CanonicalEventType.ADMIN_UNPAUSED,
  UpgradedEvent: CanonicalEventType.ADMIN_UPGRADED,
  AdminChangedEvent: CanonicalEventType.ADMIN_CHANGED,
  ProjectCanceledEvent: CanonicalEventType.PROJECT_CANCELED,
  ContributionRefundedEvent: CanonicalEventType.CONTRIBUTION_REFUNDED,
  ContributorPayoutEvent: CanonicalEventType.CONTRIBUTION_PAID_OUT,
  ProjectExpiredEvent: CanonicalEventType.PROJECT_EXPIRED,
  ContributionClawedBackEvent: CanonicalEventType.CONTRIBUTION_CLAWED_BACK,
  ProtocolFeeDeductedEvent: CanonicalEventType.FEE_DEDUCTED,
  MilestoneVoteStartedEvent: CanonicalEventType.MILESTONE_VOTE_STARTED,
  FeeConfigChangedEvent: CanonicalEventType.ADMIN_FEE_CONFIG_CHANGED,
  VoteCastEvent: CanonicalEventType.MILESTONE_VOTE_CAST,
  MilestoneApprovedByVoteEvent: CanonicalEventType.MILESTONE_APPROVED_BY_VOTE,
  MilestoneDisputedEvent: CanonicalEventType.MILESTONE_DISPUTED,
  MilestoneDisputeResolvedEvent: CanonicalEventType.MILESTONE_DISPUTE_RESOLVED,
  StorageMigratedEvent: CanonicalEventType.ADMIN_STORAGE_MIGRATED,
  RoundCreatedEvent: CanonicalEventType.POOL_ROUND_CREATED,
  PoolFundedEvent: CanonicalEventType.POOL_FUNDED,
  ProjectApprovedEvent: CanonicalEventType.POOL_PROJECT_APPROVED,
  ProjectRemovedEvent: CanonicalEventType.POOL_PROJECT_REMOVED,
  ContributionRecordedEvent: CanonicalEventType.POOL_CONTRIBUTION_RECORDED,
  RoundFinalizedEvent: CanonicalEventType.POOL_ROUND_FINALIZED,
  MatchDistributedEvent: CanonicalEventType.POOL_MATCH_DISTRIBUTED,
  AllMatchesDistributedEvent: CanonicalEventType.POOL_ALL_MATCHES_DISTRIBUTED,
  BurnEvent: CanonicalEventType.TOKEN_BURNED,
  VestingCreatedEvent: CanonicalEventType.TOKEN_VESTING_CREATED,
  TokensClaimedEvent: CanonicalEventType.TOKEN_CLAIMED,
  StreamCreatedEvent: CanonicalEventType.TOKEN_STREAM_CREATED,
  DelegateApprovedEvent: CanonicalEventType.TOKEN_DELEGATE_APPROVED,
  DelegateRevokedEvent: CanonicalEventType.TOKEN_DELEGATE_REVOKED,
  DelegatedClaimEvent: CanonicalEventType.TOKEN_DELEGATED_CLAIM,
  PriceUpdatedEvent: CanonicalEventType.PRICE_UPDATED,
  OracleUpdatedEvent: CanonicalEventType.PRICE_ORACLE_UPDATED,
  ProposalCreatedEvent: CanonicalEventType.GOVERNANCE_PROPOSAL_CREATED,
  SignatureCollectedEvent: CanonicalEventType.GOVERNANCE_SIGNATURE_COLLECTED,
  ProposalExecutedEvent: CanonicalEventType.GOVERNANCE_PROPOSAL_EXECUTED,
  ProposalCancelledEvent: CanonicalEventType.GOVERNANCE_PROPOSAL_CANCELLED,
  MultisigConfiguredEvent: CanonicalEventType.GOVERNANCE_MULTISIG_CONFIGURED,
  GaslessRegistrationEvent: CanonicalEventType.REPUTATION_UPDATED,
  BadgeGrantedEvent: CanonicalEventType.REPUTATION_BADGE_GRANTED,
  BadgeRevokedEvent: CanonicalEventType.REPUTATION_BADGE_REVOKED,
  ReputationPenaltyAppliedEvent: CanonicalEventType.REPUTATION_PENALTY_APPLIED,
  ModuleRegisteredEvent: CanonicalEventType.MODULE_REGISTERED,
  ModuleUpdatedEvent: CanonicalEventType.MODULE_UPDATED,
  ModuleDeactivatedEvent: CanonicalEventType.MODULE_DEACTIVATED,
  ModuleActivatedEvent: CanonicalEventType.MODULE_ACTIVATED,
  ModuleAdminTransferredEvent: CanonicalEventType.ADMIN_TRANSFERRED,
  AdminTransferredEvent: CanonicalEventType.ADMIN_TRANSFERRED,
  ProjectRegisteredEvent: CanonicalEventType.PROJECT_CREATED,
  ProjectVerifiedEvent: CanonicalEventType.PROJECT_VERIFIED,
  ProjectRejectedEvent: CanonicalEventType.PROJECT_REJECTED,
  VerificationOverriddenEvent: CanonicalEventType.ADMIN_VERIFICATION_OVERRIDDEN,
};

const CURATION_EVENT_MAP: Record<string, CanonicalEventType> = {
  proposed: CanonicalEventType.PROJECT_PROPOSED,
  voted: CanonicalEventType.MILESTONE_VOTE_CAST,
  verified: CanonicalEventType.PROJECT_VERIFIED,
  rejected: CanonicalEventType.PROJECT_REJECTED,
  expired: CanonicalEventType.GOVERNANCE_PROPOSAL_EXPIRED,
};

export interface CanonicalMapping {
  canonicalType: CanonicalEventType;
  category: EventCategory;
}

export function mapSorobanEvent(
  eventType: string | null,
): CanonicalMapping | null {
  if (!eventType) return null;

  const mapped = RAW_EVENT_MAP[eventType] ?? CURATION_EVENT_MAP[eventType];
  if (!mapped) return null;

  return { canonicalType: mapped, category: getCategory(mapped) };
}
