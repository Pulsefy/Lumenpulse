const mockServerSecret = 'mock-server-secret-for-redaction-test';

const mockConfig = {
  stellar: {
    network: 'testnet' as const,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    timeout: 3000,
    serverSecret: {
      reveal: jest.fn(() => mockServerSecret),
    },
    contracts: {
      lumenToken: null as string | null,
      crowdfundVault: null as string | null,
      projectRegistry: null as string | null,
      contributorRegistry: null as string | null,
      matchingPool: null as string | null,
      treasury: null as string | null,
    },
  },
};

jest.mock('../lib/config', () => ({
  config: mockConfig,
}));

import { StrKey } from '@stellar/stellar-sdk';
import { ContractHealthService } from './contract-health.service';

const makeContractId = (seed: number): string =>
  StrKey.encodeContract(Buffer.alloc(32, seed));

const resetContracts = () => {
  Object.assign(mockConfig.stellar.contracts, {
    lumenToken: null,
    crowdfundVault: null,
    projectRegistry: null,
    contributorRegistry: null,
    matchingPool: null,
    treasury: null,
  });
};

describe('ContractHealthService', () => {
  let service: ContractHealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    resetContracts();
    service = new ContractHealthService();
  });

  it('reports missing contract IDs as misconfigured without loading RPC context', async () => {
    const loadSpy = jest.spyOn(service as any, 'loadSimulationContext');

    const report = await service.getContractHealthReport();

    expect(report.status).toBe('error');
    expect(report.summary).toEqual({
      total: 6,
      reachable: 0,
      misconfigured: 6,
      unreachable: 0,
    });
    expect(report.contracts.every((contract) => !contract.configured)).toBe(
      true,
    );
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('runs configured read calls and marks a callable contract as reachable', async () => {
    mockConfig.stellar.contracts.lumenToken = makeContractId(1);
    jest
      .spyOn(service as any, 'loadSimulationContext')
      .mockResolvedValue({ context: 'mock' });
    const simulateSpy = jest
      .spyOn(service as any, 'simulateContractRead')
      .mockImplementation((_context, _contractId: string, method: string) =>
        Promise.resolve({
          method,
          status: 'ok',
          returnType: 'scvU32',
        }),
      );

    const report = await service.getContractHealthReport();
    const lumenToken = report.contracts.find(
      (contract) => contract.name === 'lumenToken',
    );

    expect(lumenToken).toEqual(
      expect.objectContaining({
        configured: true,
        status: 'reachable',
        envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
      }),
    );
    expect(lumenToken?.readMethods.map((check) => check.method)).toEqual([
      'decimals',
      'symbol',
    ]);
    expect(simulateSpy).toHaveBeenCalledTimes(2);
  });

  it('reports invalid contract IDs as misconfigured before simulation', async () => {
    mockConfig.stellar.contracts.lumenToken = 'not-a-contract';
    const loadSpy = jest.spyOn(service as any, 'loadSimulationContext');

    const report = await service.getContractHealthReport();
    const lumenToken = report.contracts.find(
      (contract) => contract.name === 'lumenToken',
    );

    expect(lumenToken).toEqual(
      expect.objectContaining({
        configured: true,
        status: 'misconfigured',
        contractId: '[invalid-contract-id]',
        message:
          'STELLAR_CONTRACT_LUMEN_TOKEN is not a valid Stellar contract ID',
      }),
    );
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('redacts configured IDs and secrets from failed read messages', async () => {
    const treasuryId = makeContractId(2);
    mockConfig.stellar.contracts.treasury = treasuryId;
    jest
      .spyOn(service as any, 'loadSimulationContext')
      .mockResolvedValue({ context: 'mock' });
    jest
      .spyOn(service as any, 'simulateContractRead')
      .mockImplementation((_context, _contractId: string, method: string) =>
        Promise.resolve(
          method === 'get_admin'
            ? {
                method,
                status: 'ok',
                returnType: 'scvAddress',
              }
            : {
                method,
                status: 'failed',
                message: `Call failed for ${treasuryId} using ${mockServerSecret}`,
              },
        ),
      );

    const report = await service.getContractHealthReport();
    const treasury = report.contracts.find(
      (contract) => contract.name === 'treasury',
    );
    const serialized = JSON.stringify(report);

    expect(treasury).toEqual(
      expect.objectContaining({
        configured: true,
        status: 'unreachable',
        contractId: `${treasuryId.slice(0, 6)}...${treasuryId.slice(-6)}`,
      }),
    );
    expect(serialized).not.toContain(treasuryId);
    expect(serialized).not.toContain(mockServerSecret);
    expect(serialized).toContain('[REDACTED]');
  });
});
