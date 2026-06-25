import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { toTreasuryException } from '../../treasury/treasury-error.util';
import { toVestingWalletException } from '../../vesting-wallet/vesting-error.util';
import {
  SorobanErrorCode,
  SorobanRpcError,
} from '../services/soroban-rpc-client.service';

export interface SorobanApiError {
  code: ErrorCode;
  message: string;
  status: HttpStatus;
  details?: Record<string, unknown>;
}

const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

export function extractContractErrorCode(message: string): number | null {
  const match = CONTRACT_ERROR_PATTERN.exec(message);
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return null;
}

export function mapSorobanRpcErrorToApi(err: SorobanRpcError): SorobanApiError {
  const details: Record<string, unknown> = { sorobanCode: err.code };
  const contractErrorCode = extractContractErrorCode(err.message);
  if (contractErrorCode !== null) {
    details.contractErrorCode = contractErrorCode;
  }

  switch (err.code) {
    case SorobanErrorCode.SIMULATION_FAILED:
      return {
        code: ErrorCode.STEL_SIMULATION_FAILED,
        message: err.message,
        status: HttpStatus.BAD_REQUEST,
        details,
      };
    case SorobanErrorCode.SUBMISSION_FAILED:
      return {
        code: ErrorCode.STEL_TRANSACTION_FAILED,
        message: err.message,
        status: HttpStatus.BAD_GATEWAY,
        details,
      };
    case SorobanErrorCode.TIMEOUT:
      return {
        code: ErrorCode.STEL_RPC_TIMEOUT,
        message: err.message,
        status: HttpStatus.GATEWAY_TIMEOUT,
        details,
      };
    case SorobanErrorCode.ACCOUNT_NOT_FOUND:
      return {
        code: ErrorCode.STEL_WALLET_NOT_FOUND,
        message: err.message,
        status: HttpStatus.NOT_FOUND,
        details,
      };
    case SorobanErrorCode.NETWORK_ERROR:
    case SorobanErrorCode.MAX_RETRIES_EXCEEDED:
      return {
        code: ErrorCode.STEL_RPC_UNAVAILABLE,
        message: err.message,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        details,
      };
    default:
      return {
        code: ErrorCode.STEL_RPC_UNAVAILABLE,
        message: err.message,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        details,
      };
  }
}

export function throwSorobanRpcError(err: SorobanRpcError): never {
  const mapped = mapSorobanRpcErrorToApi(err);
  throw new HttpException(
    {
      code: mapped.code,
      message: mapped.message,
      details: mapped.details,
    },
    mapped.status,
  );
}

export function mapContractDiagnosticToError(
  message: string,
  domain: 'treasury' | 'vesting' | 'generic',
  beneficiary?: string,
): HttpException {
  switch (domain) {
    case 'treasury':
      return toTreasuryException(message, beneficiary);
    case 'vesting':
      return toVestingWalletException(message, beneficiary);
    default: {
      const contractErrorCode = extractContractErrorCode(message);
      const details =
        contractErrorCode !== null ? { contractErrorCode } : undefined;
      return new HttpException(
        {
          code: ErrorCode.STEL_SIMULATION_FAILED,
          message,
          details,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
