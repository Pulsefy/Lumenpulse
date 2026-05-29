import { Test, TestingModule } from '@nestjs/testing';
import { MatchingPoolController } from './matching-pool.controller';
import { MatchingPoolService } from './matching-pool.service';
import { ConfigService } from '@nestjs/config';

describe('MatchingPoolController', () => {
  let controller: MatchingPoolController;
  let service: MatchingPoolService;

  const mockService = {
    createRound: jest.fn().mockResolvedValue({
      roundId: 1,
      transactionHash: 'mock_tx_123',
      status: 'SUCCESS',
    }),
    approveProject: jest.fn().mockResolvedValue({
      transactionHash: 'mock_tx_456',
      status: 'SUCCESS',
    }),
    finalizeRound: jest.fn().mockResolvedValue({
      transactionHash: 'mock_tx_789',
      status: 'SUCCESS',
    }),
    getRound: jest.fn().mockResolvedValue({
      id: 1,
      name: 'Round1',
      tokenAddress: 'CDLZEA...',
      startTime: 1000,
      endTime: 2000,
      totalPool: '0',
      isFinalized: false,
      eligibleProjects: [1, 2],
      status: 'ACTIVE',
    }),
    listRounds: jest.fn().mockResolvedValue([
      {
        id: 1,
        name: 'Round1',
        tokenAddress: 'CDLZEA...',
        startTime: 1000,
        endTime: 2000,
        totalPool: '0',
        isFinalized: false,
        eligibleProjects: [1, 2],
        status: 'ACTIVE',
      },
    ]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MatchingPoolController],
      providers: [
        {
          provide: MatchingPoolService,
          useValue: mockService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, defaultValue) => {
              if (key === 'ADMIN_USERNAME') return 'admin';
              if (key === 'ADMIN_PASSWORD') return 'admin-secret';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<MatchingPoolController>(MatchingPoolController);
    service = module.get<MatchingPoolService>(MatchingPoolService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createRound', () => {
    it('should create round', async () => {
      const dto = {
        name: 'Round1',
        tokenAddress: 'CDLZEA...',
        startTime: 1000,
        endTime: 2000,
      };
      const result = await controller.createRound(dto);
      expect(result).toEqual({
        roundId: 1,
        transactionHash: 'mock_tx_123',
        status: 'SUCCESS',
      });
      expect(service.createRound).toHaveBeenCalledWith(dto);
    });
  });

  describe('approveProject', () => {
    it('should approve a project', async () => {
      const result = await controller.approveProject(1, { projectId: 42 });
      expect(result).toEqual({
        transactionHash: 'mock_tx_456',
        status: 'SUCCESS',
      });
      expect(service.approveProject).toHaveBeenCalledWith(1, 42);
    });
  });

  describe('finalizeRound', () => {
    it('should finalize a round', async () => {
      const result = await controller.finalizeRound(1);
      expect(result).toEqual({
        transactionHash: 'mock_tx_789',
        status: 'SUCCESS',
      });
      expect(service.finalizeRound).toHaveBeenCalledWith(1);
    });
  });

  describe('getRound', () => {
    it('should get round details', async () => {
      const result = await controller.getRound(1);
      expect(result.id).toBe(1);
      expect(service.getRound).toHaveBeenCalledWith(1);
    });
  });

  describe('listRounds', () => {
    it('should list all rounds', async () => {
      const result = await controller.listRounds();
      expect(result).toHaveLength(1);
      expect(service.listRounds).toHaveBeenCalled();
    });
  });
});
