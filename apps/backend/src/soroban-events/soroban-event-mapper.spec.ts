import { mapSorobanEvent } from './soroban-event-mapper';
import { CanonicalEventType, EventCategory } from '../common/event-catalog';

describe('mapSorobanEvent', () => {
  it('maps ProjectCreatedEvent to project.created', () => {
    const result = mapSorobanEvent('ProjectCreatedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_CREATED,
      category: EventCategory.PROJECT,
    });
  });

  it('maps DepositEvent to contribution.deposited', () => {
    const result = mapSorobanEvent('DepositEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.CONTRIBUTION_DEPOSITED,
      category: EventCategory.CONTRIBUTION,
    });
  });

  it('maps BurnEvent to token.burned', () => {
    const result = mapSorobanEvent('BurnEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_BURNED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps RoundCreatedEvent to pool.round_created', () => {
    const result = mapSorobanEvent('RoundCreatedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.POOL_ROUND_CREATED,
      category: EventCategory.POOL,
    });
  });

  it('maps UpgradedEvent to admin.upgraded', () => {
    const result = mapSorobanEvent('UpgradedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.ADMIN_UPGRADED,
      category: EventCategory.ADMIN,
    });
  });

  it('maps VestingCreatedEvent to token.vesting_created', () => {
    const result = mapSorobanEvent('VestingCreatedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_VESTING_CREATED,
      category: EventCategory.TOKEN,
    });
  });

  it('maps PriceUpdatedEvent to price.updated', () => {
    const result = mapSorobanEvent('PriceUpdatedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PRICE_UPDATED,
      category: EventCategory.PRICE,
    });
  });

  it('maps curation proposed to project.proposed', () => {
    const result = mapSorobanEvent('proposed');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_PROPOSED,
      category: EventCategory.PROJECT,
    });
  });

  it('maps curation verified to project.verified', () => {
    const result = mapSorobanEvent('verified');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.PROJECT_VERIFIED,
      category: EventCategory.PROJECT,
    });
  });

  it('maps BadgeGrantedEvent to reputation.badge_granted', () => {
    const result = mapSorobanEvent('BadgeGrantedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.REPUTATION_BADGE_GRANTED,
      category: EventCategory.REPUTATION,
    });
  });

  it('returns null for null input', () => {
    expect(mapSorobanEvent(null)).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(mapSorobanEvent('UnknownEvent')).toBeNull();
  });

  it('maps ModuleRegisteredEvent to module.registered', () => {
    const result = mapSorobanEvent('ModuleRegisteredEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.MODULE_REGISTERED,
      category: EventCategory.MODULE,
    });
  });

  it('maps StreamCreatedEvent to token.stream_created', () => {
    const result = mapSorobanEvent('StreamCreatedEvent');
    expect(result).toEqual({
      canonicalType: CanonicalEventType.TOKEN_STREAM_CREATED,
      category: EventCategory.TOKEN,
    });
  });
});
