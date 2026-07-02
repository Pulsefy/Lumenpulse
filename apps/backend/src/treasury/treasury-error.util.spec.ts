import { ErrorCode } from '../common/enums/error-code.enum';
import {
  extractContractErrorCode,
  mapContractErrorCode,
  toTreasuryException,
} from './treasury-error.util';
import {
  TreasuryInvalidAmountException,
  TreasuryStreamNotFoundException,
  TreasuryTransactionFailedException,
  TreasuryUnauthorizedException,
} from './exceptions/treasury.exceptions';

describe('extractContractErrorCode', () => {
  it('extracts the code from a HostError diagnostic', () => {
    expect(extractContractErrorCode('HostError: Error(Contract, #3) ...')).toBe(
      3,
    );
  });

  it('extracts the code with flexible whitespace', () => {
    expect(extractContractErrorCode('Error(Contract,#7)')).toBe(7);
  });

  it('returns null when there is no contract error', () => {
    expect(extractContractErrorCode('some network timeout')).toBeNull();
  });
});

describe('mapContractErrorCode', () => {
  it('maps Unauthorized (3) to the unauthorized exception', () => {
    const ex = mapContractErrorCode(3);
    expect(ex).toBeInstanceOf(TreasuryUnauthorizedException);
    expect(ex.getStatus()).toBe(403);
    expect((ex.getResponse() as { code: string }).code).toBe(
      ErrorCode.TREAS_UNAUTHORIZED,
    );
  });

  it('maps InvalidAmount (4) to a 400', () => {
    const ex = mapContractErrorCode(4);
    expect(ex).toBeInstanceOf(TreasuryInvalidAmountException);
    expect(ex.getStatus()).toBe(400);
  });

  it('maps StreamNotFound (7) with the beneficiary in details', () => {
    const ex = mapContractErrorCode(7, undefined, 'GABC');
    expect(ex).toBeInstanceOf(TreasuryStreamNotFoundException);
    expect(
      (ex.getResponse() as { details: { beneficiary: string } }).details,
    ).toEqual({ beneficiary: 'GABC' });
  });

  it('falls back to a generic failure for unknown codes', () => {
    const ex = mapContractErrorCode(999, 'boom');
    expect(ex).toBeInstanceOf(TreasuryTransactionFailedException);
    expect((ex.getResponse() as { code: string }).code).toBe(
      ErrorCode.TREAS_TRANSACTION_FAILED,
    );
  });
});

describe('toTreasuryException', () => {
  it('maps a diagnostic string with a known contract code', () => {
    const ex = toTreasuryException('Error(Contract, #3)');
    expect(ex).toBeInstanceOf(TreasuryUnauthorizedException);
  });

  it('returns a generic failure when no code is present', () => {
    const ex = toTreasuryException('connection reset');
    expect(ex).toBeInstanceOf(TreasuryTransactionFailedException);
  });
});
