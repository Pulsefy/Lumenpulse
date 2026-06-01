import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrowdfundVaultSyncService } from './crowdfund-vault-sync.service';
import { CrowdfundVaultEventEntity } from './entities/crowdfund-vault-event.entity';
import { CrowdfundVaultProjectEntity } from './entities/crowdfund-vault-project.entity';
import { CrowdfundVaultContributorEntity } from './entities/crowdfund-vault-contributor.entity';
import { CrowdfundVaultMilestoneEntity } from './entities/crowdfund-vault-milestone.entity';
import { CrowdfundVaultSyncCheckpointEntity } from './entities/crowdfund-vault-sync-checkpoint.entity';

const VAULT_CONTRACT = 'CVAULT123456789';

jest.mock('../lib/config', () => ({
  config: {
    stellar: {
      contracts: {
        crowdfundVault: 'CVAULT123456789',
      },
    },
  },
}));

describe('CrowdfundVaultSyncService', () => {
  let service: CrowdfundVaultSyncService;
  let eventRepo: jest.Mocked<Repository<CrowdfundVaultEventEntity>>;
  let projectRepo: jest.Mocked<Repository<CrowdfundVaultProjectEntity>>;
  let contributorRepo: jest.Mocked<Repository<CrowdfundVaultContributorEntity>>;
  let milestoneRepo: jest.Mocked<Repository<CrowdfundVaultMilestoneEntity>>;
  let checkpointRepo: jest.Mocked<Repository<CrowdfundVaultSyncCheckpointEntity>>;

  const projects = new Map<string, CrowdfundVaultProjectEntity>();
  const contributors = new Map<string, CrowdfundVaultContributorEntity>();
  const events = new Map<string, CrowdfundVaultEventEntity>();

  beforeEach(async () => {
    projects.clear();
    contributors.clear();
    events.clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrowdfundVaultSyncService,
        {
          provide: getRepositoryToken(CrowdfundVaultEventEntity),
          useValue: createEventRepoMock(),
        },
        {
          provide: getRepositoryToken(CrowdfundVaultProjectEntity),
          useValue: createProjectRepoMock(),
        },
        {
          provide: getRepositoryToken(CrowdfundVaultContributorEntity),
          useValue: createContributorRepoMock(),
        },
        {
          provide: getRepositoryToken(CrowdfundVaultMilestoneEntity),
          useValue: createMilestoneRepoMock(),
        },
        {
          provide: getRepositoryToken(CrowdfundVaultSyncCheckpointEntity),
          useValue: createCheckpointRepoMock(),
        },
      ],
    }).compile();

    service = module.get(CrowdfundVaultSyncService);
    eventRepo = module.get(getRepositoryToken(CrowdfundVaultEventEntity));
    projectRepo = module.get(getRepositoryToken(CrowdfundVaultProjectEntity));
    contributorRepo = module.get(
      getRepositoryToken(CrowdfundVaultContributorEntity),
    );
    milestoneRepo = module.get(getRepositoryToken(CrowdfundVaultMilestoneEntity));
    checkpointRepo = module.get(
      getRepositoryToken(CrowdfundVaultSyncCheckpointEntity),
    );
  });

  function createEventRepoMock() {
    return {
      findOne: jest.fn(async ({ where }: { where: { txHash: string; eventIndex: number } }) => {
        return events.get(`${where.txHash}:${where.eventIndex}`) ?? null;
      }),
      create: jest.fn((data: CrowdfundVaultEventEntity) => ({ id: 'ev-1', ...data })),
      save: jest.fn(async (entity: CrowdfundVaultEventEntity) => {
        events.set(`${entity.txHash}:${entity.eventIndex}`, entity);
        return entity;
      }),
    };
  }

  function createProjectRepoMock() {
    return {
      findOne: jest.fn(async ({ where }: { where: { projectId: string } }) => {
        return projects.get(where.projectId) ?? null;
      }),
      create: jest.fn((data: Partial<CrowdfundVaultProjectEntity>) => ({
        id: 'proj-1',
        uniqueContributors: 0,
        totalContributions: '0',
        totalWithdrawn: '0',
        status: 'active',
        ...data,
      })),
      save: jest.fn(async (entity: CrowdfundVaultProjectEntity) => {
        projects.set(entity.projectId, entity);
        return entity;
      }),
      upsert: jest.fn(
        async (data: Partial<CrowdfundVaultProjectEntity>, _keys: string[]) => {
          const existing = projects.get(String(data.projectId));
          const merged = {
            ...(existing ?? {
              id: 'proj-1',
              uniqueContributors: 0,
              totalContributions: '0',
              totalWithdrawn: '0',
            }),
            ...data,
          } as CrowdfundVaultProjectEntity;
          projects.set(String(data.projectId), merged);
        },
      ),
      update: jest.fn(
        async (
          criteria: { projectId: string },
          data: Partial<CrowdfundVaultProjectEntity>,
        ) => {
          const existing = projects.get(criteria.projectId);
          if (existing) {
            Object.assign(existing, data);
          }
        },
      ),
    };
  }

  function createContributorRepoMock() {
    return {
      findOne: jest.fn(
        async ({
          where,
        }: {
          where: { projectId: string; contributor: string };
        }) => {
          return (
            contributors.get(`${where.projectId}:${where.contributor}`) ?? null
          );
        },
      ),
      create: jest.fn((data: Partial<CrowdfundVaultContributorEntity>) => ({
        id: 'contrib-1',
        totalContributed: '0',
        ...data,
      })),
      save: jest.fn(async (entity: CrowdfundVaultContributorEntity) => {
        contributors.set(`${entity.projectId}:${entity.contributor}`, entity);
        return entity;
      }),
    };
  }

  function createMilestoneRepoMock() {
    return {
      findOne: jest.fn(),
      upsert: jest.fn(),
    };
  }

  function createCheckpointRepoMock() {
    let lastLedger = '0';
    return {
      findOne: jest.fn(async () =>
        lastLedger === '0'
          ? null
          : ({ contractId: VAULT_CONTRACT, lastLedger }),
      ),
      upsert: jest.fn(async (data: { contractId: string; lastLedger: string }) => {
        lastLedger = data.lastLedger;
      }),
    };
  }

  it('identifies the configured vault contract', () => {
    expect(service.isVaultContract(VAULT_CONTRACT)).toBe(true);
    expect(service.isVaultContract('OTHER')).toBe(false);
  });

  it('materializes deposit events and updates contributor totals', async () => {
    await service.syncVaultEvent({
      txHash: 'tx-deposit-1',
      eventIndex: 0,
      contractId: VAULT_CONTRACT,
      eventType: 'DepositEvent',
      ledgerSeq: 100,
      rawPayload: {
        projectId: 1,
        user: 'GUSER111',
        amount: '5000000',
      },
    });

    const project = projects.get('1');
    expect(project?.totalContributions).toBe('5000000');
    expect(project?.lastLedgerSeq).toBe('100');

    const contributor = contributors.get('1:GUSER111');
    expect(contributor?.totalContributed).toBe('5000000');

    expect(eventRepo.save).toHaveBeenCalledTimes(1);
    expect(checkpointRepo.upsert).toHaveBeenCalled();
  });

  it('skips replay of the same tx/event index (idempotent)', async () => {
    const input = {
      txHash: 'tx-replay',
      eventIndex: 0,
      contractId: VAULT_CONTRACT,
      eventType: 'DepositEvent',
      ledgerSeq: 200,
      rawPayload: { projectId: 2, user: 'GUSER222', amount: '100' },
    };

    await service.syncVaultEvent(input);
    await service.syncVaultEvent(input);

    expect(eventRepo.save).toHaveBeenCalledTimes(1);
    expect(projects.get('2')?.totalContributions).toBe('100');
  });

  it('ignores stale ledger sequences for project updates', async () => {
    projects.set('3', {
      id: 'proj-3',
      projectId: '3',
      contractId: VAULT_CONTRACT,
      owner: 'GOWNER',
      tokenAddress: null,
      totalContributions: '1000',
      totalWithdrawn: '0',
      uniqueContributors: 1,
      status: 'active',
      refundWindowDeadline: null,
      lastLedgerSeq: '500',
      lastTxHash: 'tx-newer',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.syncVaultEvent({
      txHash: 'tx-stale',
      eventIndex: 0,
      contractId: VAULT_CONTRACT,
      eventType: 'DepositEvent',
      ledgerSeq: 400,
      rawPayload: { projectId: 3, user: 'GUSER333', amount: '999' },
    });

    expect(projects.get('3')?.totalContributions).toBe('1000');
  });

  it('records milestone approvals', async () => {
    await service.syncVaultEvent({
      txHash: 'tx-milestone',
      eventIndex: 0,
      contractId: VAULT_CONTRACT,
      eventType: 'MilestoneApprovedEvent',
      ledgerSeq: 600,
      rawPayload: { projectId: 4, milestoneId: 1 },
    });

    expect(milestoneRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '4',
        milestoneId: 1,
        status: 'approved',
      }),
      ['projectId', 'milestoneId'],
    );
  });

  it('applies refund window expiry and contribution reversals', async () => {
    projects.set('5', {
      id: 'proj-5',
      projectId: '5',
      contractId: VAULT_CONTRACT,
      owner: 'GOWNER',
      tokenAddress: null,
      totalContributions: '2000',
      totalWithdrawn: '0',
      uniqueContributors: 1,
      status: 'active',
      refundWindowDeadline: null,
      lastLedgerSeq: '700',
      lastTxHash: 'tx-base',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    contributors.set('5:GUSER555', {
      id: 'c-5',
      projectId: '5',
      contributor: 'GUSER555',
      totalContributed: '2000',
      firstContributionLedger: '700',
      lastContributionLedger: '700',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.syncVaultEvent({
      txHash: 'tx-expired',
      eventIndex: 0,
      contractId: VAULT_CONTRACT,
      eventType: 'ProjectExpiredEvent',
      ledgerSeq: 710,
      rawPayload: {
        projectId: 5,
        refundWindowDeadline: 999999,
      },
    });

    expect(projects.get('5')?.status).toBe('expired');
    expect(projects.get('5')?.refundWindowDeadline).toBe('999999');

    await service.syncVaultEvent({
      txHash: 'tx-refund',
      eventIndex: 1,
      contractId: VAULT_CONTRACT,
      eventType: 'ContributionRefundedEvent',
      ledgerSeq: 720,
      rawPayload: {
        projectId: 5,
        contributor: 'GUSER555',
        amount: '500',
      },
    });

    expect(projects.get('5')?.totalContributions).toBe('1500');
    expect(contributors.get('5:GUSER555')?.totalContributed).toBe('1500');
  });
});
