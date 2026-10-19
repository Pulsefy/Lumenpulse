import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { ServiceApiKey } from './entities/service-api-key.entity';
import { ServiceApiKeysService } from './service-api-keys.service';

describe('ServiceApiKeysService', () => {
  let service: ServiceApiKeysService;
  let repository: jest.Mocked<Partial<Repository<ServiceApiKey>>>;
  let rows: ServiceApiKey[];

  beforeEach(() => {
    rows = [];
    repository = {
      create: jest.fn((value) => value as ServiceApiKey),
      save: jest.fn((value) =>
        Promise.resolve().then(() => {
          const entity = value as ServiceApiKey;
          entity.id = entity.id ?? `key-${rows.length + 1}`;
          entity.createdAt = entity.createdAt ?? new Date();
          const existing = rows.findIndex((row) => row.id === entity.id);
          if (existing === -1) {
            rows.push(entity);
          } else {
            rows[existing] = entity;
          }
          return entity;
        }),
      ),
      find: jest.fn(({ where }) =>
        Promise.resolve(
          rows.filter((row) => row.consumerId === where?.consumerId),
        ),
      ),
      findOne: jest.fn(({ where }) =>
        Promise.resolve(
          rows.find(
            (row) =>
              row.id === where?.id && row.consumerId === where?.consumerId,
          ) ?? null,
        ),
      ),
    };
    service = new ServiceApiKeysService(
      repository as Repository<ServiceApiKey>,
    );
  });

  it('issues a one-time secret and persists only its verifier', async () => {
    const issued = await service.issue(
      'data-processing',
      { name: 'primary', scopes: ['data:read'] },
      'admin-id',
    );

    expect(issued.key).toMatch(/^lp_sk_/);
    expect(issued.apiKey).not.toHaveProperty('key');
    expect(rows[0].keyHash).toBe(
      createHash('sha256').update(issued.key, 'utf8').digest('hex'),
    );
    expect(rows[0].keyHash).not.toContain(issued.key);
    expect(issued.apiKey).toMatchObject({
      consumerId: 'data-processing',
      scopes: ['data:read'],
      revokedAt: null,
    });
  });

  it('rotates with overlap and revokes only the selected key', async () => {
    const first = await service.issue(
      'consumer-a',
      { scopes: ['data:read', 'data:write'] },
      'admin-id',
    );
    const second = await service.rotate(
      'consumer-a',
      first.apiKey.id,
      'admin-id',
    );

    expect(second.key).not.toBe(first.key);
    expect(rows[0].revokedAt).toBeNull();
    expect(second.apiKey.scopes).toEqual(['data:read', 'data:write']);

    await service.revoke('consumer-a', first.apiKey.id, 'admin-id');
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[0].revokedBy).toBe('admin-id');
    expect(rows[1].revokedAt).toBeNull();
    expect(await service.list('consumer-a')).toHaveLength(2);
  });

  it('rejects empty or unsupported scopes', async () => {
    await expect(
      service.issue('consumer-a', { scopes: [] }, 'admin-id'),
    ).rejects.toThrow('At least one API key scope is required');
    await expect(
      service.issue('consumer-a', { scopes: ['*' as 'data:read'] }, 'admin-id'),
    ).rejects.toThrow('Scopes must be one or more of');
  });

  it('rejects consumer identifiers that cannot be safely attributed', async () => {
    await expect(
      service.issue('consumer\nforged', { scopes: ['data:read'] }, 'admin-id'),
    ).rejects.toThrow('Invalid service consumer identifier');
  });
});
