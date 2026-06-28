const mockContractHealthService = {
  getContractHealthReport: jest.fn(),
};

jest.mock('../lib/config', () => ({
  config: {
    stellar: {
      network: 'testnet',
      contracts: {
        lumenToken: null,
        crowdfundVault: null,
        projectRegistry: null,
        contributorRegistry: null,
        matchingPool: null,
        treasury: null,
      },
    },
  },
}));

import { SmokeEndpointService } from './smoke-endpoint.service';

describe('SmokeEndpointService', () => {
  let service: SmokeEndpointService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SmokeEndpointService(mockContractHealthService as any);
  });

  describe('getSmokeReport', () => {
    it('returns smoke report with env var checks and contract checks', async () => {
      mockContractHealthService.getContractHealthReport.mockResolvedValue({
        status: 'ok',
        contracts: [
          {
            name: 'lumenToken',
            envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
            configured: true,
            status: 'reachable',
            contractId: 'CDLZF...T7GY6',
            readMethods: [],
          },
        ],
      });

      const report = await service.getSmokeReport();

      expect(report.status).toBe('ok');
      expect(report.network).toBe('testnet');
      expect(report.checkedAt).toBeDefined();
      expect(report.envVars).toHaveLength(4);
      expect(report.envVars[0].name).toBe('STELLAR_NETWORK');
      expect(report.contracts).toHaveLength(6);
    });

    it('returns error status when env vars are missing', async () => {
      mockContractHealthService.getContractHealthReport.mockResolvedValue({
        status: 'ok',
        contracts: [],
      });

      const report = await service.getSmokeReport();

      expect(report.status).toBe('error');
      expect(report.envVars.some((e) => !e.configured)).toBe(true);
    });

    it('returns error status when contracts are misconfigured', async () => {
      mockContractHealthService.getContractHealthReport.mockResolvedValue({
        status: 'error',
        contracts: [
          {
            name: 'lumenToken',
            envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
            configured: false,
            status: 'misconfigured',
            contractId: undefined,
            readMethods: [],
          },
        ],
      });

      const report = await service.getSmokeReport();

      expect(report.status).toBe('error');
    });

    it('returns error status when contracts are unreachable', async () => {
      mockContractHealthService.getContractHealthReport.mockResolvedValue({
        status: 'error',
        contracts: [
          {
            name: 'lumenToken',
            envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
            configured: true,
            status: 'unreachable',
            contractId: 'CDLZF...T7GY6',
            readMethods: [],
            message: 'Soroban RPC healthcheck source account is unavailable',
          },
        ],
      });

      const report = await service.getSmokeReport();

      expect(report.status).toBe('error');
      expect(report.contracts[0].status).toBe('unreachable');
    });
  });
});