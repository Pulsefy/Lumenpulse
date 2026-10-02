import {
  ANONYMISED_PLACEHOLDER,
  USER_DATA_INVENTORY,
  UserDataDisposition,
  anonymisedSubjectId,
  redactPersonalData,
  userDataStoreFor,
} from './user-data-inventory';

describe('USER_DATA_INVENTORY', () => {
  it('lists every store at most once', () => {
    const tables = USER_DATA_INVENTORY.map((store) => store.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('documents a retention period and rationale for every store', () => {
    for (const store of USER_DATA_INVENTORY) {
      expect(store.description.trim()).not.toBe('');
      expect(store.retention.trim()).not.toBe('');
      expect(store.rationale.trim()).not.toBe('');
      expect(store.userColumns.length).toBeGreaterThan(0);
      if (store.disposition === UserDataDisposition.DELETE) {
        expect(store.retentionDays === null || store.retentionDays > 0).toBe(
          true,
        );
      }
    }
  });

  it('retains audit and moderation records by anonymising them', () => {
    const anonymised = USER_DATA_INVENTORY.filter(
      (store) => store.disposition === UserDataDisposition.ANONYMISE,
    ).map((store) => store.table);

    expect(anonymised).toEqual(
      expect.arrayContaining([
        'audit_logs',
        'audit_log_archive',
        'admin_blockchain_audit_logs',
        'content_reports',
        'review_comments',
        'review_decision_history',
        'verification_requests',
      ]),
    );
  });

  it('looks a store up by table name', () => {
    expect(userDataStoreFor('watchlist_items')?.disposition).toBe(
      UserDataDisposition.DELETE,
    );
    expect(userDataStoreFor('not_a_table')).toBeUndefined();
  });
});

describe('anonymisedSubjectId', () => {
  it('is stable, prefixed and does not leak the user id', () => {
    const id = '9f1c2a4e-6b1d-4f3a-9c2e-1a2b3c4d5e6f';
    const subject = anonymisedSubjectId(id);

    expect(subject).toBe(anonymisedSubjectId(id));
    expect(subject).toMatch(/^anon:[0-9a-f]{32}$/);
    expect(subject).not.toContain(id);
  });
});

describe('redactPersonalData', () => {
  it('replaces personal values but keeps non-personal context', () => {
    const redacted = redactPersonalData({
      action: 'login',
      email: 'ada@example.test',
      nested: { ipAddress: '127.0.0.1', metadata: { userId: 'u-1' } },
      tags: ['keep', 'also'],
      attempts: 2,
    }) as Record<string, unknown>;

    expect(redacted).toEqual({
      action: 'login',
      email: ANONYMISED_PLACEHOLDER,
      nested: {
        ipAddress: ANONYMISED_PLACEHOLDER,
        metadata: { userId: ANONYMISED_PLACEHOLDER },
      },
      tags: ['keep', 'also'],
      attempts: 2,
    });
  });

  it('passes primitives through unchanged', () => {
    expect(redactPersonalData('plain')).toBe('plain');
    expect(redactPersonalData(7)).toBe(7);
    expect(redactPersonalData(null)).toBeNull();
  });
});
