import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ExportService } from './export.service';
import {
  ExportJob,
  ExportStatus,
  ExportType,
} from './entities/export-job.entity';
import { PortfolioSnapshot } from '../portfolio/entities/portfolio-snapshot.entity';
import { TransactionService } from '../transaction/transaction.service';

const mockSnapshot = {
  id: 'snap-1',
  userId: 'user-1',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  totalValueUsd: '1500.00',
  assetBalances: [
    { assetCode: 'XLM', assetIssuer: null, amount: '1000', valueUsd: 1500 },
  ],
};

const mockTransaction = {
  id: 'tx-1',
  type: 'payment',
  amount: '100',
  assetCode: 'XLM',
  assetIssuer: null,
  from: 'GABC',
  to: 'GDEF',
  date: '2024-01-15T10:00:00Z',
  status: 'success',
  transactionHash: 'hash1',
  fee: '0.00001',
  memo: undefined,
  description: 'Sent 100 XLM to GDEF...GDEF',
};

describe('ExportService', () => {
  let service: ExportService;

  const mockExportJobRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockSnapshotRepo = {
    find: jest.fn(),
  };

  const mockTransactionService = {
    getTransactionHistory: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportService,
        { provide: getRepositoryToken(ExportJob), useValue: mockExportJobRepo },
        {
          provide: getRepositoryToken(PortfolioSnapshot),
          useValue: mockSnapshotRepo,
        },
        { provide: TransactionService, useValue: mockTransactionService },
      ],
    }).compile();

    service = module.get<ExportService>(ExportService);
  });

  describe('createExportJob', () => {
    it('creates and returns a pending job', async () => {
      const job: Partial<ExportJob> = {
        id: 'job-1',
        userId: 'user-1',
        type: ExportType.PORTFOLIO_HISTORY,
        status: ExportStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockExportJobRepo.create.mockReturnValue(job);
      mockExportJobRepo.save.mockResolvedValue(job);
      mockSnapshotRepo.find.mockResolvedValue([mockSnapshot]);
      mockExportJobRepo.update.mockResolvedValue(undefined);

      const result = await service.createExportJob(
        'user-1',
        ExportType.PORTFOLIO_HISTORY,
      );

      expect(result.status).toBe(ExportStatus.PENDING);
      expect(mockExportJobRepo.save).toHaveBeenCalledWith(job);
    });
  });

  describe('getJob', () => {
    it('returns the job when found', async () => {
      const job = {
        id: 'job-1',
        userId: 'user-1',
        status: ExportStatus.COMPLETED,
      };
      mockExportJobRepo.findOne.mockResolvedValue(job);

      const result = await service.getJob('job-1', 'user-1');
      expect(result).toBe(job);
    });

    it('throws NotFoundException when job not found', async () => {
      mockExportJobRepo.findOne.mockResolvedValue(null);
      await expect(service.getJob('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listJobs', () => {
    it('returns jobs for the user', async () => {
      const jobs = [{ id: 'job-1' }, { id: 'job-2' }];
      mockExportJobRepo.find.mockResolvedValue(jobs);

      const result = await service.listJobs('user-1');
      expect(result).toHaveLength(2);
      expect(mockExportJobRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });

  describe('CSV generation', () => {
    it('builds portfolio history CSV with correct headers', async () => {
      const job: Partial<ExportJob> = {
        id: 'job-1',
        userId: 'user-1',
        type: ExportType.PORTFOLIO_HISTORY,
        status: ExportStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockExportJobRepo.create.mockReturnValue(job);
      mockExportJobRepo.save.mockResolvedValue(job);
      mockSnapshotRepo.find.mockResolvedValue([mockSnapshot]);

      let capturedCsv = '';
      mockExportJobRepo.update.mockImplementation(
        (_id: string, data: Partial<ExportJob>) => {
          if (data.csvData) capturedCsv = data.csvData;
          return Promise.resolve(undefined);
        },
      );

      await service.createExportJob('user-1', ExportType.PORTFOLIO_HISTORY);
      // Allow async processing to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(capturedCsv).toContain('snapshot_id,date,asset_code');
      expect(capturedCsv).toContain('XLM');
      expect(capturedCsv).toContain('1500.00');
    });

    it('builds tax transactions CSV with correct headers', async () => {
      const job: Partial<ExportJob> = {
        id: 'job-2',
        userId: 'user-1',
        type: ExportType.TAX_TRANSACTIONS,
        status: ExportStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockExportJobRepo.create.mockReturnValue(job);
      mockExportJobRepo.save.mockResolvedValue(job);
      mockTransactionService.getTransactionHistory.mockResolvedValue({
        transactions: [mockTransaction],
      });

      let capturedCsv = '';
      mockExportJobRepo.update.mockImplementation(
        (_id: string, data: Partial<ExportJob>) => {
          if (data.csvData) capturedCsv = data.csvData;
          return Promise.resolve(undefined);
        },
      );

      await service.createExportJob('user-1', ExportType.TAX_TRANSACTIONS);
      await new Promise((r) => setTimeout(r, 50));

      expect(capturedCsv).toContain('transaction_id,date,type,asset_code');
      expect(capturedCsv).toContain('tx-1');
      expect(capturedCsv).toContain('payment');
    });

    it('marks job as failed when CSV generation throws', async () => {
      const job: Partial<ExportJob> = {
        id: 'job-3',
        userId: 'user-1',
        type: ExportType.PORTFOLIO_HISTORY,
        status: ExportStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockExportJobRepo.create.mockReturnValue(job);
      mockExportJobRepo.save.mockResolvedValue(job);
      mockSnapshotRepo.find.mockRejectedValue(new Error('DB error'));

      const updates: Array<Partial<ExportJob>> = [];
      mockExportJobRepo.update.mockImplementation(
        (_id: string, data: Partial<ExportJob>) => {
          updates.push(data);
          return Promise.resolve(undefined);
        },
      );

      await service.createExportJob('user-1', ExportType.PORTFOLIO_HISTORY);
      await new Promise((r) => setTimeout(r, 50));

      const failedUpdate = updates.find(
        (u) => u.status === ExportStatus.FAILED,
      );
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate?.errorMessage).toBe('DB error');
    });
  });
});
