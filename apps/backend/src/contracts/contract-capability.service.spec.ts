import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service';
import { ContractCapabilityService } from './contract-capability.service';

describe('ContractCapabilityService', () => {
  let service: ContractCapabilityService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractCapabilityService,
        {
          provide: ConfigService,
          useValue: {
            getStellarConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ContractCapabilityService>(ContractCapabilityService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCapabilityCatalog', () => {
    it('should return catalog with environment metadata', () => {
      const mockStellarConfig: any = {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contracts: {
          lumenToken:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          crowdfundVault:
            'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO',
          projectRegistry:
            'CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC',
          contributorRegistry:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          matchingPool:
            'CBQJ2E2MPYRCQDHZZYJXHRKUTCTIJFO55AVGHB2WDZSLS2OOENUDC6HH',
          treasury: 'CD56RQ3JBYKZIDB7TINYRWFLPAUVGVGQPCOYE2VYZYXP2TSEA5E52IQ5',
        },
      };

      jest
        .spyOn(configService, 'getStellarConfig')
        .mockReturnValue(mockStellarConfig);
      // Mock process.env directly instead of using 'get' accessor
      const originalEnv = process.env;
      process.env = { ...originalEnv, NODE_ENV: 'development' };

      const result = service.getCapabilityCatalog();

      expect(result).toBeDefined();
      expect(result.environment).toBe('development');
      expect(result.apiVersion).toBe('v1');
      expect(result.catalogVersion).toBe('1.0.0');
      expect(result.generatedAt).toBeDefined();
      expect(result.contracts).toBeInstanceOf(Array);
      expect(result.contracts.length).toBeGreaterThan(0);

      // Restore original process.env
      process.env = originalEnv;
    });

    it('should include all defined contracts', () => {
      const mockStellarConfig: any = {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contracts: {
          lumenToken:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          crowdfundVault:
            'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO',
          projectRegistry:
            'CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC',
          contributorRegistry:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          matchingPool:
            'CBQJ2E2MPYRCQDHZZYJXHRKUTCTIJFO55AVGHB2WDZSLS2OOENUDC6HH',
          treasury: 'CD56RQ3JBYKZIDB7TINYRWFLPAUVGVGQPCOYE2VYZYXP2TSEA5E52IQ5',
        },
      };

      jest
        .spyOn(configService, 'getStellarConfig')
        .mockReturnValue(mockStellarConfig);

      const result = service.getCapabilityCatalog();

      // Check that we have at least the expected contracts
      const contractIds = result.contracts.map((c) => c.contractId);
      expect(contractIds).toContain('lumen-token');
      expect(contractIds).toContain('crowdfund-vault');
      expect(contractIds).toContain('project-registry');
      expect(contractIds).toContain('contributor-registry');
      expect(contractIds).toContain('matching-pool');
      expect(contractIds).toContain('treasury');
      expect(contractIds).toContain('vesting-wallet');
    });

    it('should mark contracts with addresses as active', () => {
      const mockStellarConfig: any = {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contracts: {
          lumenToken:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          crowdfundVault: null, // Not deployed
          projectRegistry: null,
          contributorRegistry: null,
          matchingPool: null,
          treasury: null,
        },
      };

      jest
        .spyOn(configService, 'getStellarConfig')
        .mockReturnValue(mockStellarConfig);

      const result = service.getCapabilityCatalog();

      const lumenToken = result.contracts.find(
        (c) => c.contractId === 'lumen-token',
      );
      const crowdfundVault = result.contracts.find(
        (c) => c.contractId === 'crowdfund-vault',
      );

      expect(lumenToken?.status).toBe('active');
      expect(crowdfundVault?.status).toBe('upcoming');
    });
  });

  describe('getContractCapabilities', () => {
    it('should return specific contract capabilities', () => {
      const mockStellarConfig: any = {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contracts: {
          lumenToken:
            'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
          crowdfundVault: null,
          projectRegistry: null,
          contributorRegistry: null,
          matchingPool: null,
          treasury: null,
        },
      };

      jest
        .spyOn(configService, 'getStellarConfig')
        .mockReturnValue(mockStellarConfig);

      const result = service.getContractCapabilities('lumen-token');

      expect(result).toBeDefined();
      expect(result?.contractId).toBe('lumen-token');
      expect(result?.displayName).toBe('Lumen Token');
      expect(result?.supportedMethods).toBeInstanceOf(Array);
      expect(result?.supportedMethods.length).toBeGreaterThan(0);
    });

    it('should return null for unknown contract', () => {
      const mockStellarConfig: any = {
        network: 'testnet' as const,
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
      };

      jest
        .spyOn(configService, 'getStellarConfig')
        .mockReturnValue(mockStellarConfig);

      const result = service.getContractCapabilities('unknown-contract');
      expect(result).toBeNull();
    });
  });
});
