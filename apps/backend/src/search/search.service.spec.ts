import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchService } from './search.service';
import { VerificationService } from '../verification/verification.service';
import { StellarService } from '../stellar/stellar.service';
import { News } from '../news/news.entity';
import { VerificationStatus } from '../verification/dto/verification.dto';

describe('SearchService', () => {
  let service: SearchService;
  let verificationService: { listProjects: jest.Mock };
  let stellarService: { discoverAssets: jest.Mock };
  let newsRepo: Pick<Repository<News>, 'query'>;

  beforeEach(async () => {
    verificationService = { listProjects: jest.fn() };
    stellarService = { discoverAssets: jest.fn() };
    newsRepo = { query: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: VerificationService, useValue: verificationService },
        { provide: StellarService, useValue: stellarService },
        { provide: getRepositoryToken(News), useValue: newsRepo },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  describe('searchProjects', () => {
    it('ranks exact/prefix/contains matches and supports numeric id', () => {
      verificationService.listProjects.mockReturnValue([
        {
          projectId: 2,
          name: 'Alpha',
          ownerPublicKey: 'G1',
          status: VerificationStatus.Pending,
          votesFor: 0,
          votesAgainst: 0,
          registeredAt: 2,
          resolvedAt: 0,
          quorumProgress: 0,
        },
        {
          projectId: 1,
          name: 'LumenPulse',
          ownerPublicKey: 'G2',
          status: VerificationStatus.Verified,
          votesFor: 3,
          votesAgainst: 0,
          registeredAt: 1,
          resolvedAt: 0,
          quorumProgress: 100,
        },
      ]);

      const byName = service.searchProjects({ q: 'lumen', limit: 10, offset: 0 });
      expect(byName.total).toBe(1);
      expect(byName.items[0].projectId).toBe(1);
      expect(byName.items[0].score).toBeGreaterThan(0);

      const byId = service.searchProjects({ q: '2' });
      expect(byId.total).toBe(1);
      expect(byId.items[0].projectId).toBe(2);
      expect(byId.items[0].score).toBe(100);
    });

    it('passes status filter through and paginates', () => {
      verificationService.listProjects.mockReturnValue(
        Array.from({ length: 30 }, (_, i) => ({
          projectId: i,
          name: `Project ${i}`,
          ownerPublicKey: 'G',
          status: VerificationStatus.Pending,
          votesFor: 0,
          votesAgainst: 0,
          registeredAt: i,
          resolvedAt: 0,
          quorumProgress: 0,
        })),
      );

      const res = service.searchProjects({
        status: VerificationStatus.Pending,
        limit: 10,
        offset: 10,
      });
      expect(verificationService.listProjects).toHaveBeenCalledWith(
        VerificationStatus.Pending,
      );
      expect(res.items).toHaveLength(10);
      expect(res.limit).toBe(10);
      expect(res.offset).toBe(10);
      expect(res.total).toBe(30);
    });
  });

  describe('searchAssets', () => {
    it('filters and sorts assets by relevance and account count', async () => {
      stellarService.discoverAssets.mockResolvedValue({
        assets: [
          { assetCode: 'USDC', assetIssuer: 'GI', assetType: 'credit', numAccounts: 10 },
          { assetCode: 'USD', assetIssuer: 'GI', assetType: 'credit', numAccounts: 5 },
          { assetCode: 'XLM', assetIssuer: 'native', assetType: 'native', numAccounts: 999 },
        ],
        hasMore: false,
        nextCursor: undefined,
        total: 3,
      });

      const res = await service.searchAssets({ q: 'usd', minAccounts: 0 });
      expect(res.assets[0].assetCode).toBe('USD');

      const resAccounts = await service.searchAssets({ sort: 'accounts' } as any);
      expect(resAccounts.assets[0].assetCode).toBe('XLM');
    });

    it('applies minAccounts/maxAccounts/authRequired filters', async () => {
      stellarService.discoverAssets.mockResolvedValue({
        assets: [
          {
            assetCode: 'A',
            assetIssuer: 'GI',
            assetType: 'credit',
            numAccounts: 5,
            flags: { authRequired: true, authRevocable: false, authImmutable: false },
          },
          {
            assetCode: 'B',
            assetIssuer: 'GI',
            assetType: 'credit',
            numAccounts: 500,
            flags: { authRequired: false, authRevocable: false, authImmutable: false },
          },
        ],
        hasMore: false,
        nextCursor: undefined,
      });

      const res = await service.searchAssets({
        minAccounts: 100,
        authRequired: false,
      } as any);
      expect(res.assets).toHaveLength(1);
      expect(res.assets[0].assetCode).toBe('B');
    });
  });

  describe('searchEcosystemEntities', () => {
    it('queries tags and returns normalized response', async () => {
      (newsRepo.query as jest.Mock).mockResolvedValue([
        { value: 'stellar', count: 10 },
        { value: 'soroban', count: 5 },
      ]);

      const res = await service.searchEcosystemEntities({ q: 'st', limit: 25 });
      expect(newsRepo.query).toHaveBeenCalled();
      expect(res.items[0]).toEqual({ kind: 'tag', value: 'stellar', count: 10 });
    });

    it('supports category kind and omitting counts', async () => {
      (newsRepo.query as jest.Mock).mockResolvedValue([{ value: 'defi', count: 3 }]);
      const res = await service.searchEcosystemEntities({
        kind: 'category',
        includeCounts: false,
        limit: 10,
      });
      expect(res.items[0]).toEqual({ kind: 'category', value: 'defi' });
    });
  });
});

