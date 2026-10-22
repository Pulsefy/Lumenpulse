import { Test, TestingModule } from '@nestjs/testing';
import { ContractsController } from './contracts.controller';
import { ContractCapabilityService } from './contract-capability.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Reflector } from '@nestjs/core';
import { AccessControlService } from '../common/services/access-control.service';
import { AccessControlGuard } from '../common/guards/access-control.guard';
import { UnauthorizedException } from '@nestjs/common';

describe('ContractsController', () => {
  let controller: ContractsController;
  let service: ContractCapabilityService;
  let accessControlService: AccessControlService;
  let guard: AccessControlGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: ContractCapabilityService,
          useValue: {
            getCapabilityCatalog: jest.fn(),
            getContractCapabilities: jest.fn(),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
            getAll: jest.fn(),
            getAllAndOverride: jest.fn(),
            getAllAndMerge: jest.fn(),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            verifyTrustedCaller: jest.fn(),
            checkPermission: jest.fn(),
            createContext: jest.fn(),
          },
        },
        AccessControlGuard,
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    service = module.get<ContractCapabilityService>(ContractCapabilityService);
    accessControlService = module.get<AccessControlService>(AccessControlService);
    guard = module.get<AccessControlGuard>(AccessControlGuard);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCapabilities', () => {
    it('should return contract capability catalog', () => {
      const mockCatalog = {
        environment: 'development',
        apiVersion: 'v1',
        catalogVersion: '1.0.0',
        generatedAt: '2026-06-28T10:00:00Z',
        contracts: [],
      };

      jest.spyOn(service, 'getCapabilityCatalog').mockReturnValue(mockCatalog);

      const result = controller.getCapabilities();

      expect(result).toEqual(mockCatalog);
      expect(service.getCapabilityCatalog).toHaveBeenCalled();
    });
  });

  describe('getContractCapabilities', () => {
    it('should return contract capabilities for valid contract', () => {
      const mockCapabilities = {
        contractId: 'lumen-token',
        displayName: 'Lumen Token',
        version: '1.0.0',
        status: 'active',
        category: 'token',
        address: 'CCOVDGHF3XQ5RAFY5DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLGXQJSB',
        supportedMethods: [],
        network: 'testnet',
        lastValidatedAt: '2026-06-28T10:00:00Z',
      };

      jest
        .spyOn(service, 'getContractCapabilities')
        .mockReturnValue(mockCapabilities);

      const result = controller.getContractCapabilities('lumen-token');

      expect(result).toEqual(mockCapabilities);
      expect(service.getContractCapabilities).toHaveBeenCalledWith(
        'lumen-token',
      );
    });

    it('should return not found message for invalid contract', () => {
      jest.spyOn(service, 'getContractCapabilities').mockReturnValue(null);

      const result = controller.getContractCapabilities('invalid-contract');

      expect(result).toEqual({
        message: "Contract 'invalid-contract' not found in the catalog",
      });
      expect(service.getContractCapabilities).toHaveBeenCalledWith(
        'invalid-contract',
      );
    });
  });

  describe('refreshCapabilities (authorization)', () => {
    const buildContext = () => {
      const handler = ContractsController.prototype.refreshCapabilities;
      const classRef = ContractsController;
      return {
        getHandler: () => handler,
        getClass: () => classRef,
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {},
            connection: { remoteAddress: '127.0.0.1' },
            socket: { remoteAddress: '127.0.0.1' },
          }),
        }),
      } as any;
    };

    it('should reject an unauthorized call to refreshCapabilities', async () => {
      const reflector = module.get(Reflector);
      jest
        .spyOn(module.get(Reflector), 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === 'trusted_caller') {
            return { verificationType: 'api_key', required: true };
          }
          return undefined;
        });

      jest
        .spyOn(accessControlService, 'verifyTrustedCaller')
        .mockResolvedValue({ trusted: false, error: 'Invalid API key' });

      await expect(guard.canActivate(buildContext())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should allow a trusted caller to refreshCapabilities', async () => {
      jest
        .spyOn(module.get(Reflector), 'getAllAndOverride')
        .mockImplementation((key: string) => {
          if (key === 'trusted_caller') {
            return { verificationType: 'api_key', required: true };
          }
          return undefined;
        });

      jest
        .spyOn(accessControlService, 'verifyTrustedCaller')
        .mockResolvedValue({ trusted: true, callerId: 'admin' });

      const result = await guard.canActivate(buildContext());
      expect(result).toBe(true);
    });
  });
});
