const mockConfig = {
  featureFlags: {
    friendbotBootstrap: true,
  },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

jest.mock('../../common/rate-limit/rate-limit.config', () => ({
  getFriendbotBootstrapThrottleOverride: () => ({
    default: { limit: 5, ttl: 3_600_000, blockDuration: 3_600_000 },
  }),
}));

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { User, UserRole } from '../../users/entities/user.entity';
import { TestnetBootstrapController } from './testnet-bootstrap.controller';
import { TestnetBootstrapService } from '../services/testnet-bootstrap.service';

describe('TestnetBootstrapController', () => {
  let controller: TestnetBootstrapController;
  let service: { fundTestnetAccount: jest.Mock };

  const VALID_TESTNET_KEY =
    'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const adminUser = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    email: 'admin@test.com',
  } as User;

  beforeEach(async () => {
    mockConfig.featureFlags.friendbotBootstrap = true;

    service = {
      fundTestnetAccount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestnetBootstrapController],
      providers: [
        {
          provide: TestnetBootstrapService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<TestnetBootstrapController>(
      TestnetBootstrapController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates funding to the bootstrap service', async () => {
    const mockResponse = {
      success: true,
      message: 'Account successfully funded via Friendbot',
      publicKey: VALID_TESTNET_KEY,
      transactionHash: 'mock_tx_hash',
      fundingAmount: '10000',
    };
    service.fundTestnetAccount.mockResolvedValueOnce(mockResponse);

    const result = await controller.fundAccount(
      { publicKey: VALID_TESTNET_KEY },
      adminUser,
    );

    expect(result).toEqual(mockResponse);
    expect(service.fundTestnetAccount).toHaveBeenCalledWith(VALID_TESTNET_KEY);
  });

  it('rejects when the feature flag is disabled', async () => {
    mockConfig.featureFlags.friendbotBootstrap = false;

    await expect(
      controller.fundAccount({ publicKey: VALID_TESTNET_KEY }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.fundTestnetAccount).not.toHaveBeenCalled();
  });

  it('propagates service failures', async () => {
    service.fundTestnetAccount.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'STEL_010',
        message: 'This endpoint is only available on testnet',
      }),
    );

    await expect(
      controller.fundAccount({ publicKey: VALID_TESTNET_KEY }, adminUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
