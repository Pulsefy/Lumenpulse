const mockConfig = {
  stellar: {
    network: 'testnet' as const,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    timeout: 3000,
    simulationTraceLevel: 'summary' as 'off' | 'summary' | 'verbose',
  },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

import { Logger } from '@nestjs/common';
import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  rpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { Registry } from 'prom-client';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  SorobanErrorCode,
  SorobanRpcClientService,
} from './soroban-rpc-client.service';

describe('SorobanRpcClientService simulation trace logging', () => {
  let service: SorobanRpcClientService;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const simulationError = {
    error: 'HostError: Error(Contract, #3)',
    events: ['raw-event-xdr-that-should-not-be-logged'],
    transactionData: 'raw-transaction-data-that-should-not-be-logged',
    cost: {
      cpuInsns: '12000',
      memBytes: '4096',
    },
  } as unknown as rpc.Api.SimulateTransactionErrorResponse;

  beforeEach(() => {
    mockConfig.stellar.simulationTraceLevel = 'summary';
    service = new SorobanRpcClientService(
      {
        getRequestId: jest.fn(() => 'req-858'),
      } as unknown as RequestContextService,
      new Registry(),
    );
    (service as unknown as { server: { simulateTransaction: jest.Mock } }).server =
      {
        simulateTransaction: jest.fn().mockResolvedValue(simulationError),
      };

    jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs request-scoped failed simulation summary without raw payloads', async () => {
    const tx = new TransactionBuilder(
      new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '1'),
      { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        new Contract(
          'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
        ).call('create_round'),
      )
      .setTimeout(30)
      .build();
    (tx as unknown as { secret: string }).secret = 'do-not-log-this-secret';

    await expect(
      service.simulateTransaction(tx, { maxRetries: 0 }),
    ).rejects.toMatchObject({
      code: SorobanErrorCode.SIMULATION_FAILED,
    });

    const trace = errorSpy.mock.calls[0][0];
    expect(trace).toMatchObject({
      event: 'soroban.simulation.failed',
      requestId: 'req-858',
      network: 'testnet',
      contract: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
      method: 'create_round',
      operationCount: 1,
      operationTypes: ['invokeHostFunction'],
      simulationSummary: {
        status: 'failed',
        error: 'HostError: Error(Contract, #3)',
        eventCount: 1,
        hasTransactionData: true,
        cost: {
          cpuInsns: '12000',
          memBytes: '4096',
        },
      },
    });

    const serializedTrace = JSON.stringify(trace);
    expect(serializedTrace).not.toContain('do-not-log-this-secret');
    expect(serializedTrace).not.toContain('raw-event-xdr');
    expect(serializedTrace).not.toContain('raw-transaction-data');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-858' }),
      'Soroban RPC call failed',
    );
  });

  it('does not emit simulation trace logs when disabled', async () => {
    mockConfig.stellar.simulationTraceLevel = 'off';

    await expect(
      service.simulateTransaction(
        {
          operations: [{ contractId: 'CAAA', method: 'deposit' }],
        } as never,
        { maxRetries: 0 },
      ),
    ).rejects.toMatchObject({
      code: SorobanErrorCode.SIMULATION_FAILED,
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
