const mockConfig = {
  stellar: {
    network: 'testnet' as const,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    timeout: 3000,
    serverSecret: {
      reveal: jest.fn(
        () => 'SB6RIPM3GJQ7RP3Q6R5F3QIBYZHP4N27SGGCQ3R4LWA2ZKXZWQ3NU3G4',
      ),
    },
    contracts: {},
  },
  soroban: { simulationCacheEnabled: true },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

// Mock the Stellar SDK's rpc.Server to avoid real network calls
const mockSimulateTransaction = jest.fn();
const mockGetAccount = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
        getAccount: mockGetAccount,
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
      })),
      Api: actual.rpc.Api,
    },
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { SorobanRpcClientService, SorobanErrorCode } from './soroban-rpc-client.service';
import { SimulationCacheService } from './simulation-cache.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { Registry } from 'prom-client';
import { rpc } from '@stellar/stellar-sdk';

describe('SorobanRpcClientService', () => {
  let service: SorobanRpcClientService;
  let simulationCache: jest.Mocked<SimulationCacheService>;
  let registry: Registry;

  beforeEach(async () => {
    registry = new Registry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanRpcClientService,
        {
          provide: RequestContextService,
          useValue: {
            getRequestId: jest.fn().mockReturnValue('test-request-id'),
          },
        },
        {
          provide: SimulationCacheService,
          useValue: {
            onLedgerAdvance: jest.fn(),
            getOrFetch: jest.fn(),
            isEnabled: true,
          },
        },
        {
          provide: Registry,
          useValue: registry,
        },
      ],
    }).compile();

    service = module.get(SorobanRpcClientService);
    simulationCache = module.get(SimulationCacheService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('simulateTransaction', () => {
    it('propagates latestLedger to simulation cache on success', async () => {
      const mockResult = {
        latestLedger: 12345,
        result: { retval: {} },
        transactionData: '',
        events: [],
        minResourceFee: '100',
        cost: { cpuInsns: '0', memBytes: '0' },
      } as unknown as rpc.Api.SimulateTransactionResponse;

      mockSimulateTransaction.mockResolvedValue(mockResult);

      // Build a minimal mock transaction
      const mockTx = { toXDR: jest.fn() } as any;

      await service.simulateTransaction(mockTx);

      expect(simulationCache.onLedgerAdvance).toHaveBeenCalledWith(12345);
    });

    it('throws SorobanRpcError when simulation returns an error', async () => {
      const errorResult = {
        error: 'HostError: Error(Contract, #1)',
        latestLedger: 100,
      };

      // Make it look like a simulation error to rpc.Api.isSimulationError
      Object.defineProperty(errorResult, 'error', {
        value: 'HostError: Error(Contract, #1)',
        writable: false,
        enumerable: true,
      });

      mockSimulateTransaction.mockResolvedValue(errorResult);
      const mockTx = { toXDR: jest.fn() } as any;

      await expect(
        service.simulateTransaction(mockTx, { maxRetries: 0 }),
      ).rejects.toThrow();
    });

    it('does not call onLedgerAdvance when simulationCache is not present', async () => {
      // Create a service without simulation cache
      const registryNoCacheSvc = new Registry();
      const moduleNoCache: TestingModule = await Test.createTestingModule({
        providers: [
          SorobanRpcClientService,
          {
            provide: RequestContextService,
            useValue: {
              getRequestId: jest.fn().mockReturnValue('test-request-id'),
            },
          },
          {
            provide: Registry,
            useValue: registryNoCacheSvc,
          },
        ],
      }).compile();

      const serviceNoCache = moduleNoCache.get(SorobanRpcClientService);

      const mockResult = {
        latestLedger: 999,
        result: { retval: {} },
        transactionData: '',
        events: [],
        minResourceFee: '100',
        cost: { cpuInsns: '0', memBytes: '0' },
      } as unknown as rpc.Api.SimulateTransactionResponse;

      mockSimulateTransaction.mockResolvedValue(mockResult);
      const mockTx = { toXDR: jest.fn() } as any;

      // Should not throw even without simulation cache
      await expect(serviceNoCache.simulateTransaction(mockTx)).resolves.toBeDefined();

      registryNoCacheSvc.clear();
    });
  });

  describe('simulateContractReadCached', () => {
    const validAccountId = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    const validContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';

    it('delegates to simulationCache.getOrFetch when cache is enabled', async () => {
      const cachedResult = { result: 'cached' } as any;
      simulationCache.getOrFetch.mockResolvedValue(cachedResult);
      (simulationCache as any).isEnabled = true;

      const result = await service.simulateContractReadCached(
        validAccountId,
        '1',
        validContractId,
        'get_admin',
        'Test SDF Network ; September 2015',
      );

      expect(simulationCache.getOrFetch).toHaveBeenCalledWith(
        validContractId,
        'get_admin',
        {},
        expect.any(Function),
      );
      expect(result).toEqual(cachedResult);
    });

    it('calls simulateContractRead directly when cache is disabled', async () => {
      (simulationCache as any).isEnabled = false;

      const mockResult = {
        latestLedger: 100,
        result: { retval: {} },
        transactionData: '',
        events: [],
        minResourceFee: '100',
        cost: { cpuInsns: '0', memBytes: '0' },
      } as unknown as rpc.Api.SimulateTransactionResponse;

      mockSimulateTransaction.mockResolvedValue(mockResult);

      await service.simulateContractReadCached(
        validAccountId,
        '1',
        validContractId,
        'get_admin',
        'Test SDF Network ; September 2015',
      );

      expect(simulationCache.getOrFetch).not.toHaveBeenCalled();
      expect(mockSimulateTransaction).toHaveBeenCalled();
    });
  });
});
