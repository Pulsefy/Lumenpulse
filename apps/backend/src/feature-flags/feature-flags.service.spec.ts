import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlag } from './feature-flag.entity';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let repo: Partial<Repository<FeatureFlag>>;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(undefined),
      save: jest
        .fn()
        .mockImplementation((x: Partial<FeatureFlag>) =>
          Promise.resolve({ ...(x as object), id: 'uuid' } as FeatureFlag),
        ),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest
        .fn()
        .mockImplementation((x: Partial<FeatureFlag>) => x as FeatureFlag),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: getRepositoryToken(FeatureFlag), useValue: repo },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  it('upserts and reads a feature flag', async () => {
    const saved = await service.upsert('test.feature', true, { sample: 'x' });
    expect(saved.key).toBe('test.feature');
    expect(saved.enabled).toBe(true);

    // ensure isEnabled uses cache and returns true
    const enabled = await service.isEnabled('test.feature');
    expect(enabled).toBe(true);
  });
});
