import { Test, TestingModule } from '@nestjs/testing';
import { SignalsService } from './signals.service';
import { UsersService } from '../users/users.service';
import { TransactionService } from '../transaction/transaction.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import {
  TransactionType,
  TransactionStatus,
} from '../transaction/dto/transaction.dto';

describe('SignalsService', () => {
  let service: SignalsService;
  const usersServiceMock = {
    findById: jest.fn(),
    getStellarAccounts: jest.fn(),
  };
  const transactionServiceMock = {
    getTransactionHistory: jest.fn(),
  };
  const portfolioServiceMock = {
    getPortfolioSummary: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalsService,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: TransactionService, useValue: transactionServiceMock },
        { provide: PortfolioService, useValue: portfolioServiceMock },
      ],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
  });

  it('returns fallback signals when the user has no linked account and no holdings', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      stellarPublicKey: null,
    });
    usersServiceMock.getStellarAccounts.mockResolvedValue([]);
    portfolioServiceMock.getPortfolioSummary.mockResolvedValue({
      totalValueUsd: '0.00',
      assets: [],
      lastUpdated: null,
      hasLinkedAccount: false,
    });

    const response = await service.getLatestSignals('user-1');

    expect(response.userId).toBe('user-1');
    expect(response.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'No holdings or linked account',
        }),
        expect.objectContaining({
          title: 'No recent activity available',
        }),
      ]),
    );
    expect(transactionServiceMock.getTransactionHistory).not.toHaveBeenCalled();
  });

  it('produces concentration and activity signals for recent transactions', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-2',
      stellarPublicKey: 'GABC1234',
    });
    usersServiceMock.getStellarAccounts.mockResolvedValue([
      { publicKey: 'GABC1234', isPrimary: true },
    ]);
    portfolioServiceMock.getPortfolioSummary.mockResolvedValue({
      totalValueUsd: '10000.00',
      assets: [
        { assetCode: 'XLM', assetIssuer: null, amount: '9000', valueUsd: 8000 },
        {
          assetCode: 'USDC',
          assetIssuer: null,
          amount: '2000',
          valueUsd: 2000,
        },
      ],
      lastUpdated: new Date(),
      hasLinkedAccount: true,
    });
    transactionServiceMock.getTransactionHistory.mockResolvedValue({
      transactions: [
        {
          id: 'tx-1',
          type: TransactionType.SWAP,
          amount: '1000',
          assetCode: 'XLM',
          assetIssuer: null,
          from: 'GABC1234',
          to: 'GDEF5678',
          date: new Date().toISOString(),
          status: TransactionStatus.SUCCESS,
          transactionHash: 'hash-1',
          description: 'Swap transaction',
        },
      ],
    });

    const response = await service.getLatestSignals('user-2');

    expect(response.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Concentrated holdings',
          severity: 'high',
        }),
        expect.objectContaining({
          title: 'Account is actively rebalancing',
          severity: 'medium',
        }),
      ]),
    );
  });
});
