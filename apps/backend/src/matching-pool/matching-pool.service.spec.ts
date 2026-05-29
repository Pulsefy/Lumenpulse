import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MatchingPoolService } from './matching-pool.service';

describe('MatchingPoolService', () => {
  let service: MatchingPoolService;

  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 1000;
  const endTime = now + 10000;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingPoolService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, defaultValue) => {
              if (key === 'USE_MOCK_TRANSACTIONS') return true;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MatchingPoolService>(MatchingPoolService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRound', () => {
    it('should create a round successfully in mock mode', async () => {
      const result = await service.createRound({
        name: 'TestRound',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        startTime,
        endTime,
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('SUCCESS');
      expect(result.roundId).toBeGreaterThanOrEqual(0);
      expect(result.transactionHash).toContain('mock_tx_');

      const details = await service.getRound(result.roundId);
      expect(details.name).toBe('TestRound');
      expect(details.isFinalized).toBe(false);
    });

    it('should throw BadRequestException if endTime <= startTime', async () => {
      await expect(
        service.createRound({
          name: 'InvalidRound',
          tokenAddress:
            'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
          startTime: endTime,
          endTime: startTime,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveProject', () => {
    it('should approve a project successfully for an active round', async () => {
      const round = await service.createRound({
        name: 'RoundToApprove',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        startTime,
        endTime,
      });

      const result = await service.approveProject(round.roundId, 42);
      expect(result.status).toBe('SUCCESS');
      expect(result.transactionHash).toBeDefined();

      const details = await service.getRound(round.roundId);
      expect(details.eligibleProjects).toContain(42);
    });

    it('should throw NotFoundException if round does not exist', async () => {
      await expect(service.approveProject(9999, 42)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if round is already finalized', async () => {
      const round = await service.createRound({
        name: 'RoundToFinalize',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        startTime,
        endTime,
      });

      await service.finalizeRound(round.roundId);

      await expect(service.approveProject(round.roundId, 42)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('finalizeRound', () => {
    it('should finalize a round successfully', async () => {
      const round = await service.createRound({
        name: 'FinalizeMe',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        startTime,
        endTime,
      });

      const result = await service.finalizeRound(round.roundId);
      expect(result.status).toBe('SUCCESS');

      const details = await service.getRound(round.roundId);
      expect(details.isFinalized).toBe(true);
      expect(details.status).toBe('FINALIZED');
    });

    it('should throw NotFoundException if round does not exist', async () => {
      await expect(service.finalizeRound(9999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if round is already finalized', async () => {
      const round = await service.createRound({
        name: 'DoubleFinalize',
        tokenAddress:
          'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        startTime,
        endTime,
      });

      await service.finalizeRound(round.roundId);

      await expect(service.finalizeRound(round.roundId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('queries', () => {
    it('should list rounds including seeded and newly created rounds', async () => {
      const list = await service.listRounds();
      expect(list.length).toBeGreaterThanOrEqual(2); // Should have at least seeded mock rounds (Round1, GenesisRound)
    });
  });
});
