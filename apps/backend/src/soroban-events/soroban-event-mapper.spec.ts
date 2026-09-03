import { mapSorobanEvent } from './soroban-event-mapper';
import { CanonicalEventType, EventCategory } from '../common/event-catalog';

describe('mapSorobanEvent', () => {
  it('maps project_created_event to project.created', () => {
    const result = mapSorobanEvent('project_created_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_CREATED,
      category: EventCategory.PROJECT,
    });
  });

  it('maps deposit_event to contribution.deposited', () => {
    const result = mapSorobanEvent('deposit_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.CONTRIBUTION_DEPOSITED,
      category: EventCategory.CONTRIBUTION,
    });
  });

  it('maps burn_event to token.burned', () => {
    const result = mapSorobanEvent('burn_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_BURNED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps round_created_event to pool.round_created', () => {
    const result = mapSorobanEvent('round_created_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.POOL_ROUND_CREATED,
      category: EventCategory.POOL,
    });
  });

  it('maps upgraded_event to admin.upgraded', () => {
    const result = mapSorobanEvent('upgraded_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_UPGRADED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps vesting_created_event to token.vesting_created', () => {
    const result = mapSorobanEvent('vesting_created_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_VESTING_CREATED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps price_updated_event to price.updated', () => {
    const result = mapSorobanEvent('price_updated_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PRICE_UPDATED,
      category: EventCategory.PRICE,
    });
  });

  // Regression test for issue #1231: `lumenpulse-curation` publishes its
  // events via `#[contractevent]` like every other contract in this
  // workspace, so the real on-chain topic is `to_snake_case` of the struct
  // name (`project_proposed_event`, from struct `ProjectProposedEvent`),
  // never a short symbol like `proposed`. A prior version of this mapper
  // keyed a separate `CURATION_EVENT_MAP` by the short symbol, which never
  // matched anything the contract actually emitted — these events were
  // silently unmapped from day one.
  it('maps project_proposed_event (lumenpulse-curation) to project.proposed', () => {
    const result = mapSorobanEvent('project_proposed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_PROPOSED,
      category: EventCategory.PROJECT,
    });
  });

  it('maps project_verified_event to project.verified', () => {
    const result = mapSorobanEvent('project_verified_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_VERIFIED,
      category: EventCategory.PROJECT,
    });
  });

  it('no longer maps the short curation symbol names (issue #1231)', () => {
    expect(mapSorobanEvent('proposed')).toBeNull();
    expect(mapSorobanEvent('voted')).toBeNull();
    expect(mapSorobanEvent('verified')).toBeNull();
    expect(mapSorobanEvent('rejected')).toBeNull();
    expect(mapSorobanEvent('expired')).toBeNull();
  });

  it('maps proposal_expired_event (treasury + contributor_registry + lumenpulse-curation) to governance.proposal_expired', () => {
    const result = mapSorobanEvent('proposal_expired_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.GOVERNANCE_PROPOSAL_EXPIRED,
      category: EventCategory.GOVERNANCE,
    });
  });

  it('maps milestone_decision_event to milestone.decision_recorded', () => {
    const result = mapSorobanEvent('milestone_decision_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.MILESTONE_DECISION_RECORDED,
      category: EventCategory.MILESTONE,
    });
  });

  it('maps emrg_migr_proposed_event to contribution.emergency_migration_proposed', () => {
    const result = mapSorobanEvent('emrg_migr_proposed_event');
    expect(result).toEqual({
      canonicalType:
        CanonicalEventType.CONTRIBUTION_EMERGENCY_MIGRATION_PROPOSED,
      category: EventCategory.CONTRIBUTION,
    });
  });

  it('maps pool_initialized_event (liquidity_pool / stable_swap_pool) to liquidity.pool_initialized', () => {
    const result = mapSorobanEvent('pool_initialized_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.LIQUIDITY_POOL_INITIALIZED,
      category: EventCategory.LIQUIDITY,
    });
  });

  it('maps swap_event to liquidity.swapped', () => {
    const result = mapSorobanEvent('swap_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.LIQUIDITY_SWAPPED,
      category: EventCategory.LIQUIDITY,
    });
  });

  it('maps operation_queued_event (upgradable-contract timelock) to admin.operation_queued', () => {
    const result = mapSorobanEvent('operation_queued_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_OPERATION_QUEUED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps scope_pause_changed_event to admin.scope_pause_changed', () => {
    const result = mapSorobanEvent('scope_pause_changed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_SCOPE_PAUSE_CHANGED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps attestation_suspended_event to reputation.attestation_suspended', () => {
    const result = mapSorobanEvent('attestation_suspended_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.REPUTATION_ATTESTATION_SUSPENDED,
      category: EventCategory.REPUTATION,
    });
  });

  it('maps price_invalidated_event to price.invalidated', () => {
    const result = mapSorobanEvent('price_invalidated_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PRICE_INVALIDATED,
      category: EventCategory.PRICE,
    });
  });

  it('maps badge_granted_event to reputation.badge_granted', () => {
    const result = mapSorobanEvent('badge_granted_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.REPUTATION_BADGE_GRANTED,
      category: EventCategory.REPUTATION,
    });
  });

  it('returns null for null input', () => {
    expect(mapSorobanEvent(null)).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(mapSorobanEvent('unknown_event')).toBeNull();
  });

  it('maps module_registered_event to module.registered', () => {
    const result = mapSorobanEvent('module_registered_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.MODULE_REGISTERED,
      category: EventCategory.MODULE,
    });
  });

  it('maps stream_created_event to token.stream_created', () => {
    const result = mapSorobanEvent('stream_created_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_STREAM_CREATED,
      category: EventCategory.TOKEN,
    });
  });

  // ── New coverage added under issue #1231 (event emission audit) ──────────

  it('maps mint_event (lumen_token) to token.minted', () => {
    const result = mapSorobanEvent('mint_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_MINTED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps transfer_event (lumen_token transfer + transfer_from) to token.transferred', () => {
    const result = mapSorobanEvent('transfer_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_TRANSFERRED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps allowance_changed_event to token.allowance_changed', () => {
    const result = mapSorobanEvent('allowance_changed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_ALLOWANCE_CHANGED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps account_state_changed_event (lumen_token freeze/unfreeze) to token.account_state_changed', () => {
    const result = mapSorobanEvent('account_state_changed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_ACCOUNT_STATE_CHANGED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps stream_cancelled_event (treasury) to token.stream_cancelled', () => {
    const result = mapSorobanEvent('stream_cancelled_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_STREAM_CANCELLED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps emergency_stop_event (treasury) to admin.emergency_stop', () => {
    const result = mapSorobanEvent('emergency_stop_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_EMERGENCY_STOP,
      category: EventCategory.ADMIN,
    });
  });

  it('maps config_updated_event (project_registry) to admin.config_updated', () => {
    const result = mapSorobanEvent('config_updated_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_CONFIG_UPDATED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps contributor_deregistered_event to reputation.contributor_deregistered', () => {
    const result = mapSorobanEvent('contributor_deregistered_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.REPUTATION_CONTRIBUTOR_DEREGISTERED,
      category: EventCategory.REPUTATION,
    });
  });

  it('maps admin_rotation_proposed_event (upgradable-contract) to admin.rotation_proposed', () => {
    const result = mapSorobanEvent('admin_rotation_proposed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_ROTATION_PROPOSED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps yield_invested_event (crowdfund_vault) to contribution.yield_invested', () => {
    const result = mapSorobanEvent('yield_invested_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.CONTRIBUTION_YIELD_INVESTED,
      category: EventCategory.CONTRIBUTION,
    });
  });

  it('maps subscriber_changed_event (crowdfund_vault) to contribution.subscriber_changed', () => {
    const result = mapSorobanEvent('subscriber_changed_event');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.CONTRIBUTION_SUBSCRIBER_CHANGED,
      category: EventCategory.CONTRIBUTION,
    });
  });
});
