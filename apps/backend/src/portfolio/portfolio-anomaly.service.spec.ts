import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OptimisticLockVersionMismatchError, Repository } from 'typeorm';
import { PortfolioAnomalyService } from './portfolio-anomaly.service';
import {
  PortfolioAnomaly,
  PortfolioAnomalySeverity,
  PortfolioAnomalyStatus,
} from './entities/portfolio-anomaly.entity';

describe('PortfolioAnomalyService', () => {
  let service: PortfolioAnomalyService;
  let repository: jest.Mocked<Repository<PortfolioAnomaly>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioAnomalyService,
        {
          provide: getRepositoryToken(PortfolioAnomaly),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PortfolioAnomalyService>(PortfolioAnomalyService);
    repository = module.get(getRepositoryToken(PortfolioAnomaly));
  });

  it('persists reviewer notes and acknowledges an anomaly', async () => {
    const anomaly = Object.assign(new PortfolioAnomaly(), {
      id: 'anomaly-1',
      status: PortfolioAnomalyStatus.UNRESOLVED,
      reviewerNotes: null,
      reviewerNotesUpdatedAt: null,
      reviewedAt: null,
      version: 1,
    });

    repository.create.mockReturnValue(anomaly);
    repository.save.mockResolvedValueOnce(anomaly);

    const created = await service.createAnomaly({
      userId: 'user-1',
      title: 'Large drawdown',
      description: 'Portfolio value dropped sharply',
      anomalyType: 'portfolio_drawdown',
      severity: PortfolioAnomalySeverity.HIGH,
    });

    expect(created).toBe(anomaly);

    repository.findOne.mockResolvedValue(anomaly);
    repository.save.mockResolvedValueOnce({
      ...anomaly,
      status: PortfolioAnomalyStatus.ACKNOWLEDGED,
      reviewerNotes: 'Reviewed by support',
      reviewerNotesUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      reviewedAt: new Date('2026-01-01T00:00:00.000Z'),
      version: 2,
    });

    const updated = await service.reviewAnomaly('anomaly-1', 'reviewer-1', {
      status: PortfolioAnomalyStatus.ACKNOWLEDGED,
      reviewerNotes: 'Reviewed by support',
    });

    expect(updated.status).toBe(PortfolioAnomalyStatus.ACKNOWLEDGED);
    expect(updated.reviewerNotes).toBe('Reviewed by support');
    expect(updated.reviewedAt).toBeInstanceOf(Date);
    expect(updated.reviewerNotesUpdatedAt).toBeInstanceOf(Date);
  });

  it('raises a conflict exception when a concurrent update is detected', async () => {
    const anomaly = Object.assign(new PortfolioAnomaly(), {
      id: 'anomaly-2',
      status: PortfolioAnomalyStatus.UNRESOLVED,
      version: 1,
    });

    repository.findOne.mockResolvedValue(anomaly);
    repository.save.mockRejectedValueOnce(
      new OptimisticLockVersionMismatchError('PortfolioAnomaly', 1, 2),
    );

    await expect(
      service.reviewAnomaly('anomaly-2', 'reviewer-2', {
        status: PortfolioAnomalyStatus.UNRESOLVED,
      }),
    ).rejects.toThrow(ConflictException);
  });
});
