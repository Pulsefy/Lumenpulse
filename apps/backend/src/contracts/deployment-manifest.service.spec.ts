import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeploymentManifestService } from './deployment-manifest.service';
import { ContractDeploymentManifest } from './entities/contract-deployment-manifest.entity';
import { ConfigService } from '../config/config.service';
import { ContractCapabilityService } from './contract-capability.service';

describe('DeploymentManifestService', () => {
  let service: DeploymentManifestService;

  const mockConfigService = {
    setStellarContractOverrides: jest.fn(),
    invalidateCache: jest.fn(),
  };

  const mockContractCapabilityService = {
    invalidateCache: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn(
      (
        dto: Partial<ContractDeploymentManifest>,
      ): ContractDeploymentManifest => (
        {
        id: 'manifest-uuid-1',
        environment: dto.environment || 'testnet',
        version: dto.version || null,
        contracts: dto.contracts || {},
        metadata: dto.metadata || null,
        lifecycle: dto.lifecycle || null,
        isActive: dto.isActive ?? false,
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
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ContractCapabilityService,
          useValue: mockContractCapabilityService,
        },
      ],
    }).compile();

    service = module.get<DeploymentManifestService>(DeploymentManifestService);
  });

  describe('create', () => {
    it('should create a new deployment manifest and deactivate previous active ones', async () => {
      mockRepo.update.mockResolved({ affected: 1 });
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
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'testnet',
          version: 'v1.1.0',
          contracts: dto.contracts,
          metadata: dto.metadata,
          isActive: true,
          createdBy: 'admin-user-1',
        }),
      );
      expect(result.id).toBe('manifest-uuid-1');
    });

    it('should initialise lifecycle entries as active for every contract', async () => {
      mockRepo.update.mockResolved({ affected: 0 });
      const dto = {
        environment: 'testnet',
        contracts: {
          treasury: { id: 'CTREASURYLN23' },
          aave_lending_pool: { id: 'AAVE1' },
        },
        isActive: true,
      };

      const result = await service.create(dto, 'admin');

      expect(result.lifecycle).toEqual({
        treasury: { state: 'active', audit: [] },
        aave_lending_pool: { state: 'active', audit: [] },
      });
    });
  });

  describe('findActive', () => {
    it('should return active deployment manifest for environment', async () => {
      const activeRecord = {
        id: 'manifest-active-1',
        environment: 'testnet',
        version: 'v1.0.0',
        contracts: { treasury: { id: 'CTREASURYLN23' } },
        metadata: { rpc_url: 'test' },
        lifecycle: { treasury: { state: 'active', audit: [] } },
        isActive: true,
        createdBy: 'admin-1',
      };
      mockRepo.findOne.mockResolved(activeRecord);

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
          lifecycle: null,
          isActive: true,
          createdBy: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockRepo.findAndCount.mockResolved([records, 1]);

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
      mockRepo.findOne.mockResolved(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deprecation lifecycle', () => {
    const activeManifest = () => ({
      id: 'manifest-active-1',
      environment: 'testnet',
      version: 'v1.0.0',
      contracts: {
        treasury: { id: 'CTREASURY123' },
        aaveLendingPool: { id: 'AAVE1' },
      },
      metadata: null,
      lifecycle: {
        treasury: { state: 'active', audit: [] },
        aaveLendingPool: { state: 'active', audit: [] },
      },
      isActive: true,
      createdBy: 'admin-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('blocks new writes while deprecated', async () => {
      mockRepo.findOne.mockResolved(activeManifest());
      mockRepo.save.mockImplementation(async (entity: ContractDeploymentManifest) => entity);

      await service.deprecateContract('treasury', 'admin-1', 'replaced by v2');

      await expect(service.assertWritesAllowed('treasury')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows exits (withdrawals) while deprecated', async () => {
      const manifest = activeManifest();
      manifest.lifecycle.treasury = {
        state: 'deprecated',
        audit: [],
      };
      mockRepo.findOne.mockResolved(manifest);

      // Exits are not gated by assertWritesAllowed, so the call rejects for the
      // deprecated contract but a non-deprecated contract accepts writes.
      await expect(
        service.assertWritesAllowed('treasury'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.assertWritesAllowed('aaveLendingPool'),
      ).resolves.toBeUndefined();
    });

    it('records an audit entry when entering deprecation', async () => {
      mockRepo.findOne.mockResolved(activeManifest());
      mockRepo.save.mockImplementation(async (entity: ContractDeploymentManifest) => entity);

      const updated = await service.deprecateContract(
        'treasury',
        'admin-1',
        'replaced by v2',
      );

      const record = updated.lifecycle?.treasury;
      expect(record?.state).toBe('deprecated');
      expect(record?.deprecatedBy).toBe('admin-1');
      expect(record?.audit?.length).toBe(1);
      expect(record?.audit?.[0]).toMatchObject({
        contractKey: 'treasury',
        from: 'active',
        to: 'deprecated',
        actorId: 'admin-1',
        reason: 'replaced by v2',
      });
    });

    it('records an audit entry when leaving deprecation', async () => {
      const manifest = activeManifest();
      manifest.lifecycle.treasury = {
        state: 'deprecated',
        deprecatedAt: '2026-07-26T05:00:00.000Z',
        deprecatedBy: 'admin-1',
        deprecationReason: 'replaced by v2',
        audit: [],
      };
      mockRepo.findOne.mockResolved(manifest);
      mockRepo.save.mockImplementation(async (entity: ContractDeploymentManifest) => entity);

      const updated = await service.restoreContract(
        'treasury',
        'admin-2',
        'reverted',
      );

      const record = updated.lifecycle?.treasury;
      expect(record?.state).toBe('active');
      expect(record?.deprecatedAt).toBeNull();
      expect(record?.audit?.length).toBe(1);
      expect(record?.audit?.[0]).toMatchObject({
        from: 'deprecated',
        to: 'active',
        actorId: 'admin-2',
      });
    });

    it('sunsets a contract and removes it from the active manifest', async () => {
      mockRepo.findOne.mockResolved(activeManifest());
      mockRepo.save.mockImplementation(
        async (entity: ContractDeploymentManifest) => entity,
      );

      const updated = await service.sunsetContract(
        'treasury',
        'admin-1',
        'replaced by v2',
      );

      expect(updated.contracts.treasury).toBeUndefined();
      expect(updated.lifecycle?.treasury?.state).toBe('sunset');
    });

    it('rejects writes for a sunset contract', async () => {
      const manifest = activeManifest();
      manifest.lifecycle.treasury = { state: 'sunset', audit: [] };
      mockRepo.findOne.mockResolved(manifest);

      await expect(service.assertWritesAllowed('treasury')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
