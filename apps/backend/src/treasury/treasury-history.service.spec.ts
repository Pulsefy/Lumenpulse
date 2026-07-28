import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TreasuryService } from './treasury.service';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { TreasuryBeneficiaryHistory } from './entities/treasury-beneficiary-history.entity';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';

describe('TreasuryService Beneficiary History', () => {
  let service: TreasuryService;

  const mockSorobanClient = {
    allocateBudget: jest.fn(),
    getStream: jest.fn(),
    rotateBeneficiary: jest.fn(),
  };

  const mockHistoryRepo = {
    create: jest.fn((dto: Partial<TreasuryBeneficiaryHistory>) => ({
      id: 'hist-1',
      createdAt: new Date(),

      ...dto,
    })),
    save: jest.fn((entity: TreasuryBeneficiaryHistory) =>
      Promise.resolve({ ...entity, id: entity.id || 'hist-1' }),
    ),
    findAndCount: jest.fn(),
  };

  const mockAuditLogRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryService,
        {
          provide: TreasurySorobanClient,
          useValue: mockSorobanClient,
        },
        {
          provide: getRepositoryToken(TreasuryBeneficiaryHistory),
          useValue: mockHistoryRepo,
        },
        {
          provide: getRepositoryToken(AdminBlockchainAuditLog),
          useValue: mockAuditLogRepo,
        },
      ],
    }).compile();

    service = module.get<TreasuryService>(TreasuryService);
  });

  describe('getBeneficiaryHistory', () => {
    it('should return beneficiary history from repository when records exist', async () => {
      const mockRecords = [
        {
          id: 'hist-1',
          beneficiary: 'GBENEFICIARY123',
          previousBeneficiary: null,
          action: 'ALLOCATED',
          amount: '1000000',
          txHash: 'txhash123',
          actorId: 'admin-1',
          actorEmail: 'admin@lumenpulse.io',
          createdAt: new Date(),
          metadata: null,
        },
      ];
      mockHistoryRepo.findAndCount.mockResolvedValue([mockRecords, 1]);

      const result = await service.getBeneficiaryHistory({
        beneficiary: 'GBENEFICIARY123',
      });

      expect(result.total).toBe(1);
      expect(result.beneficiary).toBe('GBENEFICIARY123');
      expect(result.history.length).toBe(1);
      expect(result.history[0].action).toBe('ALLOCATED');
    });

    it('should handle streams with no history gracefully', async () => {
      mockHistoryRepo.findAndCount.mockResolvedValue([[], 0]);
      mockAuditLogRepo.find.mockResolvedValue([]);

      const result = await service.getBeneficiaryHistory({
        beneficiary: 'GUNKNOWN123',
      });

      expect(result.total).toBe(0);
      expect(result.beneficiary).toBe('GUNKNOWN123');
      expect(result.history).toEqual([]);
    });

    it('should fall back to audit log context when history repo has no records', async () => {
      mockHistoryRepo.findAndCount.mockResolvedValue([[], 0]);
      mockAuditLogRepo.find.mockResolvedValue([
        {
          id: 'audit-1',
          actorId: 'admin-actor',
          actorEmail: 'admin@lumenpulse.io',
          endpoint: 'POST /treasury/streams',
          targetContract: 'treasury',
          paramsSummary: { beneficiary: 'GAUDIT123', amount: '500' },
          txHash: 'audithash',
          responseStatus: 201,
          createdAt: new Date(),
        },
      ]);

      const result = await service.getBeneficiaryHistory({
        beneficiary: 'GAUDIT123',
      });

      expect(result.total).toBe(1);
      expect(result.history[0].actorId).toBe('admin-actor');
      expect(result.history[0].action).toBe('ALLOCATED');
    });
  });

  describe('recordBeneficiaryHistory', () => {
    it('should save beneficiary change record', async () => {
      await service.recordBeneficiaryHistory({
        beneficiary: 'GNEW123',
        previousBeneficiary: 'GOLD123',
        action: 'ROTATED',
      });

      expect(mockHistoryRepo.create).toHaveBeenCalledWith({
        beneficiary: 'GNEW123',
        previousBeneficiary: 'GOLD123',
        action: 'ROTATED',
      });
      expect(mockHistoryRepo.save).toHaveBeenCalled();
    });
  });
});
