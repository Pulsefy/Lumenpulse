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
    contracts: {
      matchingPool: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
    },
  },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { MatchingPoolAdminService } from './matching-pool-admin.service';
import {
  SorobanErrorCode,
  SorobanRpcClientService,
  SorobanRpcError,
} from './soroban-rpc-client.service';

describe('MatchingPoolAdminService', () => {
  let service: MatchingPoolAdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingPoolAdminService,
        {
          provide: SorobanRpcClientService,
          useValue: {
            getAccount: jest.fn(),
            simulateTransaction: jest.fn(),
            sendTransaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(MatchingPoolAdminService);
    jest.clearAllMocks();
  });

  const expectHandleError = (
    err: SorobanRpcError,
    expected: {
      status: HttpStatus;
      code: ErrorCode;
      details?: Record<string, unknown>;
    },
  ) => {
    try {
      (
        service as unknown as { handleError: (e: unknown, m: string) => never }
      ).handleError(err, 'createRound');
      fail('Expected handleError to throw');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      const httpError = thrown as HttpException;
      expect(httpError.getStatus()).toBe(expected.status);
      expect(httpError.getResponse()).toMatchObject({
        code: expected.code,
        message: err.message,
        details: expected.details,
      });
    }
  };

  it('throws a standardized error when Soroban simulation fails', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.SIMULATION_FAILED,
      'Simulation failed: HostError: Error(Contract, #3)',
    );

    expectHandleError(err, {
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.STEL_SIMULATION_FAILED,
      details: {
        sorobanCode: SorobanErrorCode.SIMULATION_FAILED,
        contractErrorCode: 3,
      },
    });
  });

  it('throws a standardized error when Soroban RPC times out', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.TIMEOUT,
      'Soroban RPC request timed out after 30000ms',
    );

    expectHandleError(err, {
      status: HttpStatus.GATEWAY_TIMEOUT,
      code: ErrorCode.STEL_RPC_TIMEOUT,
      details: { sorobanCode: SorobanErrorCode.TIMEOUT },
    });
  });

  it('throws a standardized error when transaction submission fails', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.SUBMISSION_FAILED,
      'Transaction submission failed: rejected',
    );

    expectHandleError(err, {
      status: HttpStatus.BAD_GATEWAY,
      code: ErrorCode.STEL_TRANSACTION_FAILED,
      details: { sorobanCode: SorobanErrorCode.SUBMISSION_FAILED },
    });
  });
});
