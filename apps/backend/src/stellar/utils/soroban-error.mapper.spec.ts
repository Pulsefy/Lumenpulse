import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  SorobanErrorCode,
  SorobanRpcError,
} from '../services/soroban-rpc-client.service';
import {
  mapSorobanRpcErrorToApi,
  throwSorobanRpcError,
} from './soroban-error.mapper';

describe('mapSorobanRpcErrorToApi', () => {
  it('maps simulation failures with contract error codes in details', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.SIMULATION_FAILED,
      'Simulation failed: HostError: Error(Contract, #3)',
    );

    const mapped = mapSorobanRpcErrorToApi(err);

    expect(mapped).toEqual({
      code: ErrorCode.STEL_SIMULATION_FAILED,
      message: err.message,
      status: HttpStatus.BAD_REQUEST,
      details: {
        sorobanCode: SorobanErrorCode.SIMULATION_FAILED,
        contractErrorCode: 3,
      },
    });
  });

  it('maps RPC timeout errors', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.TIMEOUT,
      'Soroban RPC request timed out after 30000ms',
    );

    const mapped = mapSorobanRpcErrorToApi(err);

    expect(mapped.code).toBe(ErrorCode.STEL_RPC_TIMEOUT);
    expect(mapped.status).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(mapped.details).toEqual({ sorobanCode: SorobanErrorCode.TIMEOUT });
  });

  it('maps network errors to RPC unavailable', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.NETWORK_ERROR,
      'fetch failed',
    );

    const mapped = mapSorobanRpcErrorToApi(err);

    expect(mapped.code).toBe(ErrorCode.STEL_RPC_UNAVAILABLE);
    expect(mapped.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(mapped.details).toEqual({
      sorobanCode: SorobanErrorCode.NETWORK_ERROR,
    });
  });

  it('maps submission failures to transaction failed', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.SUBMISSION_FAILED,
      'Transaction submission failed: rejected',
    );

    const mapped = mapSorobanRpcErrorToApi(err);

    expect(mapped.code).toBe(ErrorCode.STEL_TRANSACTION_FAILED);
    expect(mapped.status).toBe(HttpStatus.BAD_GATEWAY);
    expect(mapped.details).toEqual({
      sorobanCode: SorobanErrorCode.SUBMISSION_FAILED,
    });
  });
});

describe('throwSorobanRpcError', () => {
  it('throws an HttpException with the standardized body', () => {
    const err = new SorobanRpcError(
      SorobanErrorCode.TIMEOUT,
      'Soroban RPC request timed out after 30000ms',
    );

    try {
      throwSorobanRpcError(err);
      fail('Expected throwSorobanRpcError to throw');
    } catch (thrown) {
      expect(thrown).toMatchObject({
        status: HttpStatus.GATEWAY_TIMEOUT,
        response: {
          code: ErrorCode.STEL_RPC_TIMEOUT,
          message: err.message,
          details: { sorobanCode: SorobanErrorCode.TIMEOUT },
        },
      });
    }
  });
});
