import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

describe('ConfigController', () => {
  it('delegates stellar config retrieval to ConfigService', () => {
    const getStellarConfig = jest.fn().mockReturnValue({
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contracts: {
        lumenToken: null,
        crowdfundVault: null,
        projectRegistry: null,
        contributorRegistry: null,
        matchingPool: null,
        treasury: null,
      },
    });
    const service = { getStellarConfig } as unknown as ConfigService;
    const controller = new ConfigController(service);

    const result = controller.getStellarConfig();

    expect(getStellarConfig).toHaveBeenCalledTimes(1);
    expect(result.network).toBe('testnet');
  });
});
