import {
  AuditRecordType,
  buildRetentionPolicies,
  retentionCutoff,
} from './audit-retention.policy';

describe('buildRetentionPolicies', () => {
  it('defines a documented window for every audit record type', () => {
    expect(buildRetentionPolicies({})).toEqual([
      {
        recordType: AuditRecordType.USER_ACTIVITY,
        retentionDays: 365,
        mode: 'archive',
      },
      {
        recordType: AuditRecordType.AUDIT_OPERATION,
        retentionDays: 2555,
        mode: 'archive',
      },
      {
        recordType: AuditRecordType.ADMIN_BLOCKCHAIN_ACTION,
        retentionDays: 2555,
        mode: 'archive',
      },
    ]);
  });

  it('lets each record type be overridden independently', () => {
    const policies = buildRetentionPolicies({
      AUDIT_USER_ACTIVITY_RETENTION_DAYS: '90',
      AUDIT_USER_ACTIVITY_RETENTION_MODE: 'purge',
    });

    expect(policies[0]).toEqual({
      recordType: AuditRecordType.USER_ACTIVITY,
      retentionDays: 90,
      mode: 'purge',
    });
    expect(policies[2].retentionDays).toBe(2555);
  });

  it.each(['0', '-1', '1.5', 'forever'])(
    'rejects a retention of "%s" days',
    (days) => {
      expect(() =>
        buildRetentionPolicies({ AUDIT_OPERATION_RETENTION_DAYS: days }),
      ).toThrow('AUDIT_OPERATION_RETENTION_DAYS must be a positive integer');
    },
  );

  it('rejects an unknown mode', () => {
    expect(() =>
      buildRetentionPolicies({ AUDIT_ADMIN_BLOCKCHAIN_RETENTION_MODE: 'drop' }),
    ).toThrow('AUDIT_ADMIN_BLOCKCHAIN_RETENTION_MODE must be');
  });
});

describe('retentionCutoff', () => {
  it('subtracts whole days from now', () => {
    expect(
      retentionCutoff(new Date('2026-09-23T03:00:00.000Z'), 365).toISOString(),
    ).toBe('2025-09-23T03:00:00.000Z');
  });
});
