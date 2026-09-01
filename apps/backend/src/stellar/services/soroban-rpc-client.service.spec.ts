import { Test, TestingModule } from '@nestjs/testing';
import { SorobanRpcClientService } from './soroban-rpc-client.service';
import { RequestContextService } from '../../common/services/request-context.service';
import { Logger } from '@nestjs/common';
import { rpc } from '@stellar/stellar-sdk';

describe('SorobanRpcClientService', () => {
  let service: SorobanRpcClientService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanRpcClientService,
        {
          provide: RequestContextService,
          useValue: { getRequestId: jest.fn(() => 'test-request-id') },
        },
      ],
    }).compile();

    service = module.get<SorobanRpcClientService>(SorobanRpcClientService);
    // Logger is a protected property in NestJS classes, but here it's defined as
    // private readonly logger = new Logger(...);
    // Accessing it with ['logger'] should work in TS.
    loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should log an error when simulation fails', async () => {
    // Mock simulateTransaction to return an error response
    // The stellar sdk's `isSimulationError` checks for `result.error`
    jest.spyOn(service['server'], 'simulateTransaction').mockResolvedValue({
      error: 'Simulated error',
      id: 1,
    } as any);

    await expect(
      service.simulateTransaction({} as any, {
        contractId: 'test-contract',
        method: 'test-method',
      }),
    ).rejects.toThrow();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'test-request-id',
        contract: 'test-contract',
        method: 'test-method',
        error: 'Simulated error',
      }),
      'Soroban contract simulation failed',
    );
  });
});
