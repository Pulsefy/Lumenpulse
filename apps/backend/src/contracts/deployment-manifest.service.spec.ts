import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DeploymentManifestService } from './deployment-manifest.service';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';

describe('DeploymentManifestService', () => {
  let service: DeploymentManifestService;

  const mockRepo = {
    create: jest.fn(
      (
        dto: Partial<ContractDeploymentManifest>,
      ): ContractDeploymentManifest => ({
        id: 'manifest-uuid-1',
        environment: dto.environment || 'testnet',
        version: dto.version || null,
        contracts: dto.contracts || {},
        metadata: dto.metadata || null,
        isActive: dto.isActive ?? true,
        createdBy: dto.createdBy || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    save: jest.fn((entity: ContractDeploymentManifest) =>
      Promise.resolve({ ...entity, id: entity.id || 'manifest-uuid-1' }),
    ),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentManifestService,
        {
          provide: getRepositoryToken(ContractDeploymentManifest),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<DeploymentManifestService>(DeploymentManifestService);
  });

  describe('create', () => {
    it('should create a new deployment manifest and deactivate previous active ones', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      const dto = {
        environment: 'testnet',
        version: 'v1.1.0',
        contracts: {
          treasury: { id: 'CTREASURY123', wasm_hash: 'hash123' },
        },
        metadata: { rpc_url: 'https://soroban-testnet.stellar.org:443' },
        isActive: true,
      };

      const result = await service.create(dto, 'admin-user-1');

      expect(mockRepo.update).toHaveBeenCalledWith(
        { environment: 'testnet', isActive: true },
        { isActive: false },
      );
      expect(mockRepo.create).toHaveBeenCalledWith({
        environment: 'testnet',
        version: 'v1.1.0',
        contracts: dto.contracts,
        metadata: dto.metadata,
        isActive: true,
        createdBy: 'admin-user-1',
      });
      expect(result.id).toBe('manifest-uuid-1');
    });
  });

  describe('findActive', () => {
    it('should return active deployment manifest for environment', async () => {
      const activeRecord = {
        id: 'manifest-active-1',
        environment: 'testnet',
        version: 'v1.0.0',
        contracts: { treasury: { id: 'CTREASURY123' } },
        metadata: { rpc_url: 'test' },
        isActive: true,
        createdBy: 'admin-1',
      };
      mockRepo.findOne.mockResolvedValue(activeRecord);

      const result = await service.findActive('testnet');

      expect(result.id).toBe('manifest-active-1');
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { environment: 'testnet', isActive: true },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated manifest history entries', async () => {
      const records = [
        {
          id: 'm-1',
          environment: 'testnet',
          version: 'v2.0.0',
          contracts: {},
          metadata: null,
          isActive: true,
          createdBy: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockRepo.findAndCount.mockResolvedValue([records, 1]);

      const result = await service.findAll({
        environment: 'testnet',
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(1);
      expect(result.data.length).toBe(1);
      expect(result.data[0].version).toBe('v2.0.0');
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if manifest does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
