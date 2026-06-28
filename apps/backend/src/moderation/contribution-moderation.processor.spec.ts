import { Test, TestingModule } from '@nestjs/testing';
import { ContributionModerationProcessor } from './contribution-moderation.processor';
import { ModerationService } from './moderation.service';
import { CrowdfundService } from '../crowdfund/crowdfund.service';
import { ReportReason, ReportType } from './entities/content-report.entity';
import { Job } from 'bullmq';

describe('ContributionModerationProcessor', () => {
  let processor: ContributionModerationProcessor;
  let moderationService: jest.Mocked<Partial<ModerationService>>;
  let crowdfundService: jest.Mocked<Partial<CrowdfundService>>;

  const mockSystemUser = {
    id: 'system-user-uuid',
    email: 'system-detector@lumenpulse.com',
    displayName: 'System Contribution Detector',
  };

  const mockProject = {
    id: 1,
    targetAmount: '1000',
    owner: 'GB...',
  };

  beforeEach(async () => {
    moderationService = {
      getOrCreateSystemUser: jest.fn().mockResolvedValue(mockSystemUser as any),
      createReport: jest.fn().mockResolvedValue({ id: 'report-uuid' } as any),
    };

    crowdfundService = {
      getAllContributions: jest.fn().mockReturnValue([]),
      getProject: jest.fn().mockReturnValue(mockProject as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContributionModerationProcessor,
        { provide: ModerationService, useValue: moderationService },
        { provide: CrowdfundService, useValue: crowdfundService },
      ],
    }).compile();

    processor = module.get<ContributionModerationProcessor>(
      ContributionModerationProcessor,
    );
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('process', () => {
    it('should not flag normal contribution activity', async () => {
      const mockJob = {
        data: {
          projectId: 1,
          senderPublicKey: 'G1...',
          amount: '10',
          timestamp: new Date().toISOString(),
          transactionHash: 'tx-1',
        },
      } as Job;

      crowdfundService.getAllContributions.mockReturnValue([
        {
          publicKey: 'G1...',
          amount: '10',
          timestamp: new Date(),
          transactionHash: 'tx-1',
        },
      ]);

      await processor.process(mockJob);

      expect(moderationService.createReport).not.toHaveBeenCalled();
    });

    it('should flag Rule 1: Velocity Alert (>5 contributions in 10s)', async () => {
      const now = new Date();
      const mockJob = {
        data: {
          projectId: 1,
          senderPublicKey: 'G_current',
          amount: '10',
          timestamp: now.toISOString(),
          transactionHash: 'tx-current',
        },
      } as Job;

      // 6 contributions within a 10s window (including the current one)
      const contributions = [];
      for (let i = 0; i < 6; i++) {
        contributions.push({
          publicKey: `G_${i}`,
          amount: '10',
          timestamp: new Date(now.getTime() - i * 1000), // 1s intervals
          transactionHash: `tx-${i}`,
        });
      }
      crowdfundService.getAllContributions.mockReturnValue(contributions);

      await processor.process(mockJob);

      expect(moderationService.createReport).toHaveBeenCalledWith(
        mockSystemUser.id,
        expect.objectContaining({
          targetType: ReportType.PROJECT,
          targetId: '1',
          reason: ReportReason.FRAUD,
          description: expect.stringContaining('Velocity Alert'),
        }),
      );
    });

    it('should flag Rule 2: Wallet Spammer Alert (>3 contributions in 15s from same wallet)', async () => {
      const now = new Date();
      const mockJob = {
        data: {
          projectId: 1,
          senderPublicKey: 'G_spammer',
          amount: '10',
          timestamp: now.toISOString(),
          transactionHash: 'tx-current',
        },
      } as Job;

      // 4 contributions from the same wallet in 15s
      const contributions = [];
      for (let i = 0; i < 4; i++) {
        contributions.push({
          publicKey: 'G_spammer',
          amount: '10',
          timestamp: new Date(now.getTime() - i * 2000), // 2s intervals
          transactionHash: `tx-${i}`,
        });
      }
      crowdfundService.getAllContributions.mockReturnValue(contributions);

      await processor.process(mockJob);

      expect(moderationService.createReport).toHaveBeenCalledWith(
        mockSystemUser.id,
        expect.objectContaining({
          targetType: ReportType.USER,
          targetId: 'G_spammer',
          reason: ReportReason.SPAM,
          description: expect.stringContaining('Wallet Spam Alert'),
        }),
      );
    });

    it('should flag Rule 3: Large Contribution Alert (>10k XLM or >50% target)', async () => {
      const mockJob = {
        data: {
          projectId: 1,
          senderPublicKey: 'G1',
          amount: '600', // project target is 1000, so 600 is > 50%
          timestamp: new Date().toISOString(),
          transactionHash: 'tx-large',
        },
      } as Job;

      crowdfundService.getAllContributions.mockReturnValue([
        {
          publicKey: 'G1',
          amount: '600',
          timestamp: new Date(),
          transactionHash: 'tx-large',
        },
      ]);

      await processor.process(mockJob);

      expect(moderationService.createReport).toHaveBeenCalledWith(
        mockSystemUser.id,
        expect.objectContaining({
          targetType: ReportType.PROJECT,
          targetId: '1',
          reason: ReportReason.FRAUD,
          description: expect.stringContaining('Large Amount Alert'),
        }),
      );
    });

    it('should flag Rule 4: Coordinated Multi-Wallet Alert (>4 unique wallets in 30s)', async () => {
      const now = new Date();
      const mockJob = {
        data: {
          projectId: 1,
          senderPublicKey: 'G_current',
          amount: '10',
          timestamp: now.toISOString(),
          transactionHash: 'tx-current',
        },
      } as Job;

      // 5 contributions from 5 different wallets in 30s
      const contributions = [];
      for (let i = 0; i < 5; i++) {
        contributions.push({
          publicKey: `G_wallet_${i}`,
          amount: '10',
          timestamp: new Date(now.getTime() - i * 5000), // 5s intervals
          transactionHash: `tx-${i}`,
        });
      }
      crowdfundService.getAllContributions.mockReturnValue(contributions);

      await processor.process(mockJob);

      expect(moderationService.createReport).toHaveBeenCalledWith(
        mockSystemUser.id,
        expect.objectContaining({
          targetType: ReportType.PROJECT,
          targetId: '1',
          reason: ReportReason.FRAUD,
          description: expect.stringContaining('Coordinated Multi-Wallet Alert'),
        }),
      );
    });
  });
});
