import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { SuspiciousContributionProcessor } from './suspicious-contribution.processor';
import { DetectionService } from './detection.service';
import { ModerationService } from '../moderation/moderation.service';
import { ContributionJobPayload } from './types';
import { RequestContextService } from '../common/services/request-context.service';

describe('SuspiciousContributionProcessor', () => {
  let processor: SuspiciousContributionProcessor;
  let detectionService: { detect: jest.Mock };
  let moderationService: { createReport: jest.Mock };

  beforeEach(async () => {
    detectionService = {
      detect: jest.fn().mockResolvedValue([]),
    };
    moderationService = {
      createReport: jest.fn().mockResolvedValue({ id: 'report-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuspiciousContributionProcessor,
        { provide: DetectionService, useValue: detectionService },
        { provide: ModerationService, useValue: moderationService },
      ],
    }).compile();

    processor = module.get<SuspiciousContributionProcessor>(
      SuspiciousContributionProcessor,
    );
  });

  it('runs job inside RequestContext with the correlationId from payload', async () => {
    let capturedCorrelationId: string | null = null;
    detectionService.detect.mockImplementation(async () => {
      capturedCorrelationId = RequestContextService.getCorrelationId();
      await Promise.resolve();
      return [];
    });

    const job = {
      id: 'job-999',
      data: {
        roundId: 1,
        projectId: 10,
        contributorPublicKey: 'GABC...',
        amount: '100',
        roundTotalContributions: '1000',
        contributorTotalInRound: '100',
        correlationId: 'corr-fraud-job-777',
      },
    } as Job<ContributionJobPayload>;

    const result = await processor.process(job);

    expect(result).toEqual({ flagged: false, findingCount: 0 });
    expect(capturedCorrelationId).toBe('corr-fraud-job-777');
  });

  it('falls back to job.id when correlationId is omitted in payload', async () => {
    let capturedCorrelationId: string | null = null;
    detectionService.detect.mockImplementation(async () => {
      capturedCorrelationId = RequestContextService.getCorrelationId();
      await Promise.resolve();
      return [];
    });

    const job = {
      id: 'bullmq-job-123',
      data: {
        roundId: 1,
        projectId: 10,
        contributorPublicKey: 'GABC...',
        amount: '100',
        roundTotalContributions: '1000',
        contributorTotalInRound: '100',
      },
    } as Job<ContributionJobPayload>;

    await processor.process(job);

    expect(capturedCorrelationId).toBe('bullmq-job-123');
  });
});
