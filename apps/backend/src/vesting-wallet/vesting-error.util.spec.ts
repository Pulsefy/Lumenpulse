import { ErrorCode } from '../common/enums/error-code.enum';
import {
  extractVestingWalletContractErrorCode,
  mapVestingWalletContractErrorCode,
  toVestingWalletException,
} from './vesting-error.util';
import {
  VestingWalletInsufficientBalanceException,
  VestingWalletNotFoundException,
  VestingWalletTransactionFailedException,
  VestingWalletUnauthorizedException,
} from './exceptions/vesting-wallet.exceptions';

describe('extractVestingWalletContractErrorCode', () => {
  it('extracts the code from a HostError diagnostic', () => {
    expect(
      extractVestingWalletContractErrorCode('HostError: Error(Contract, #3) ...'),
    ).toBe(3);
  });

  it('extracts the code with flexible whitespace', () => {
    expect(extractVestingWalletContractErrorCode('Error(Contract,#7)')).toBe(7);
  });

  it('returns null when there is no contract error', () => {
    expect(
      extractVestingWalletContractErrorCode('some network timeout'),
    ).toBeNull();
  });
});

describe('mapVestingWalletContractErrorCode', () => {
  it('maps Unauthorized (3) to the unauthorized exception', () => {
    const ex = mapVestingWalletContractErrorCode(3);
    expect(ex).toBeInstanceOf(VestingWalletUnauthorizedException);
    expect(ex.getStatus()).toBe(403);
    expect((ex.getResponse() as { code: string }).code).toBe(
      ErrorCode.VEST_UNAUTHORIZED,
    );
  });

  it('maps VestingNotFound (4) with the beneficiary in details', () => {
    const ex = mapVestingWalletContractErrorCode(4, undefined, 'GABC');
    expect(ex).toBeInstanceOf(VestingWalletNotFoundException);
    expect((ex.getResponse() as { details: { beneficiary: string } }).details)
      .toEqual({ beneficiary: 'GABC' });
  });

  it('maps InsufficientBalance (9) to the insufficient funds exception', () => {
    const ex = mapVestingWalletContractErrorCode(9);
    expect(ex).toBeInstanceOf(VestingWalletInsufficientBalanceException);
    expect((ex.getResponse() as { code: string }).code).toBe(
      ErrorCode.STEL_INSUFFICIENT_FUNDS,
    );
  });

  it('maps DelegateNotAuthorized (11) to the unauthorized exception', () => {
    const ex = mapVestingWalletContractErrorCode(11);
    expect(ex).toBeInstanceOf(VestingWalletUnauthorizedException);
  });

  it('falls back to a generic failure for unknown codes', () => {
    const ex = mapVestingWalletContractErrorCode(999, 'boom');
    expect(ex).toBeInstanceOf(VestingWalletTransactionFailedException);
    expect((ex.getResponse() as { code: string }).code).toBe(
      ErrorCode.VEST_TRANSACTION_FAILED,
    );
    expect(
      (ex.getResponse() as { details: { contractErrorCode: number } }).details,
    ).toEqual({ contractErrorCode: 999 });
  });
});

describe('toVestingWalletException', () => {
  it('maps a diagnostic string with a known contract code', () => {
    const ex = toVestingWalletException('Error(Contract, #3)');
    expect(ex).toBeInstanceOf(VestingWalletUnauthorizedException);
  });

  it('returns a generic failure when no code is present', () => {
    const ex = toVestingWalletException('connection reset');
    expect(ex).toBeInstanceOf(VestingWalletTransactionFailedException);
  });
});
