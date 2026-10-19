const mockConfig = {
  stellar: {
    network: 'testnet',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    timeout: 3000,
    simulationTraceLevel: 'off',
  },
};
jest.mock('../../lib/config', () => ({ config: mockConfig }));

import { Logger } from '@nestjs/common';
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { Registry } from 'prom-client';
import { RequestContextService } from '../../common/services/request-context.service';
import {
  SorobanErrorCode,
  SorobanRpcClientService,
  SorobanRpcError,
} from './soroban-rpc-client.service';
import { mapSorobanRpcErrorToApi } from '../utils/soroban-error.mapper';
import { extractTransactionResultCode } from '../utils/stellar-result-code';

const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const secondSource = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 2),
).publicKey();
const contract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';
function rejection(code: 'txBadSeq' | 'txInsufficientFee') {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result:
      code === 'txBadSeq'
        ? xdr.TransactionResultResult.txBadSeq()
        : xdr.TransactionResultResult.txInsufficientFee(),
    ext: new xdr.TransactionResultExt(0),
  });
}
function build(account: Account): Transaction {
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contract).call('test'))
    .setTimeout(30)
    .build();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Stellar sequence coordination', () => {
  let service: SorobanRpcClientService;
  let registry: Registry;
  let ledgerSequence: bigint;
  let reads: jest.SpyInstance;
  let sends: jest.SpyInstance;
  let confirmations: jest.SpyInstance;
  const pending = { status: 'PENDING', hash: 'hash-1' };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    registry = new Registry();
    service = new SorobanRpcClientService(
      new RequestContextService(),
      registry,
    );
    ledgerSequence = 100n;
    reads = jest
      .spyOn(service.rawServer, 'getAccount')
      .mockImplementation((key) =>
        Promise.resolve(new Account(key, ledgerSequence.toString())),
      );
    sends = jest
      .spyOn(service.rawServer, 'sendTransaction')
      .mockResolvedValue(pending as rpc.Api.SendTransactionResponse);
    confirmations = jest
      .spyOn(service.rawServer, 'getTransaction')
      .mockImplementation(() => {
        ledgerSequence++;
        return Promise.resolve({
          status: rpc.Api.GetTransactionStatus.SUCCESS,
        } as rpc.Api.GetTransactionResponse);
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const submit = (account: Account) =>
    service.sendTransaction(build(account), { maxRetries: 0 });

  it('serializes a deterministic two-caller race through ledger inclusion', async () => {
    const firstRead = deferred<Account>();
    const firstInclusion = deferred<rpc.Api.GetTransactionResponse>();
    reads.mockReturnValueOnce(firstRead.promise);
    confirmations.mockReturnValueOnce(firstInclusion.promise);
    const first = service.withSequence(source, submit);
    const second = service.withSequence(source, submit);
    await jest.advanceTimersByTimeAsync(0);
    expect(reads).toHaveBeenCalledTimes(1);
    firstRead.resolve(new Account(source, '100'));
    await jest.advanceTimersByTimeAsync(0);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledTimes(1);
    ledgerSequence = 101n;
    firstInclusion.resolve({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as rpc.Api.GetTransactionResponse);
    await Promise.all([first, second]);
    expect(
      sends.mock.calls.map(([tx]) => (tx as Transaction).sequence),
    ).toEqual(['101', '102']);
  });

  it('allocates unique consecutive sequences for 25 concurrent submissions', async () => {
    await Promise.all(
      Array.from({ length: 25 }, () => service.withSequence(source, submit)),
    );
    expect(
      sends.mock.calls.map(([tx]) => (tx as Transaction).sequence),
    ).toEqual(Array.from({ length: 25 }, (_, index) => String(101 + index)));
  });

  it('does not block different source accounts on the same lock', async () => {
    const stalled = deferred<Account>();
    reads.mockImplementation((key: string) =>
      key === source
        ? stalled.promise
        : Promise.resolve(new Account(key, '100')),
    );
    const first = service.withSequence(source, submit);
    await service.withSequence(secondSource, submit);
    expect(sends).toHaveBeenCalledTimes(1);
    stalled.resolve(new Account(source, '101'));
    await first;
  });

  it('rebuilds with a fresh account only after a specific tx_bad_seq rejection', async () => {
    sends.mockImplementationOnce(() => {
      ledgerSequence = 150n;
      return Promise.resolve({
        status: 'ERROR',
        errorResult: rejection('txBadSeq'),
      });
    });
    const operation = jest.fn(submit);
    const result = service.withSequence(source, operation);
    await jest.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toEqual(pending);
    expect(
      sends.mock.calls.map(([tx]) => (tx as Transaction).sequence),
    ).toEqual(['101', '151']);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(await registry.metrics()).toContain(
      'stellar_submission_failures_total{result_code="tx_bad_seq"} 1',
    );
  });

  it('bounds sequence retries and preserves the code in the API error', async () => {
    sends.mockResolvedValue({
      status: 'ERROR',
      errorResult: rejection('txBadSeq'),
    });
    const result = service.withSequence(source, submit);
    const assertion = expect(result).rejects.toMatchObject({
      code: SorobanErrorCode.BAD_SEQUENCE,
      resultCode: 'tx_bad_seq',
    });
    await jest.advanceTimersByTimeAsync(750);
    await assertion;
    expect(sends).toHaveBeenCalledTimes(3);
    const error = await result.catch((error: SorobanRpcError) => error);
    expect(mapSorobanRpcErrorToApi(error as SorobanRpcError)).toMatchObject({
      status: 502,
      details: { resultCode: 'tx_bad_seq' },
    });
    sends.mockResolvedValue(pending);
    await expect(service.withSequence(source, submit)).resolves.toEqual(
      pending,
    );
  });

  it('does not retry unrelated rejection codes and releases the lock', async () => {
    sends.mockResolvedValueOnce({
      status: 'ERROR',
      errorResult: rejection('txInsufficientFee'),
    });
    await expect(service.withSequence(source, submit)).rejects.toMatchObject({
      code: SorobanErrorCode.SUBMISSION_FAILED,
      resultCode: 'tx_insufficient_fee',
    });
    await service.withSequence(source, submit);
    expect(sends).toHaveBeenCalledTimes(2);
    expect(await registry.metrics()).toContain(
      'stellar_submission_failures_total{result_code="tx_insufficient_fee"} 1',
    );
  });

  it('never replays a newly signed transaction after an ambiguous transport timeout', async () => {
    sends.mockRejectedValueOnce(
      new SorobanRpcError(SorobanErrorCode.TIMEOUT, 'timeout'),
    );
    await expect(service.withSequence(source, submit)).rejects.toMatchObject({
      code: SorobanErrorCode.MAX_RETRIES_EXCEEDED,
      cause: { code: SorobanErrorCode.TIMEOUT },
    });
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('releases queued work after a build/simulation failure', async () => {
    const failure = new Error('simulation failed');
    const failed = service.withSequence(source, () => Promise.reject(failure));
    const next = service.withSequence(source, submit);
    await expect(failed).rejects.toBe(failure);
    await expect(next).resolves.toEqual(pending);
  });

  it('does not consume a sequence after a rejected submission', async () => {
    sends.mockResolvedValueOnce({
      status: 'ERROR',
      errorResult: rejection('txInsufficientFee'),
    });
    await expect(service.withSequence(source, submit)).rejects.toThrow();
    await service.withSequence(source, submit);
    expect(
      sends.mock.calls.map(([tx]) => (tx as Transaction).sequence),
    ).toEqual(['101', '101']);
  });

  it('keeps sequence precision above Number.MAX_SAFE_INTEGER', async () => {
    ledgerSequence = 9007199254740994n;
    await service.withSequence(source, submit);
    expect((sends.mock.calls[0][0] as Transaction).sequence).toBe(
      '9007199254740995',
    );
  });

  it('waits for NOT_FOUND submissions instead of releasing the source early', async () => {
    confirmations.mockResolvedValueOnce({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    });
    const result = service.withSequence(source, submit);
    await jest.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual(pending);
    expect(confirmations).toHaveBeenCalledTimes(2);
  });

  it('counts definitive on-ledger failures by result code', async () => {
    confirmations.mockResolvedValueOnce({
      status: rpc.Api.GetTransactionStatus.FAILED,
      resultXdr: rejection('txInsufficientFee'),
    });
    await expect(service.withSequence(source, submit)).rejects.toMatchObject({
      resultCode: 'tx_insufficient_fee',
    });
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('bounds confirmation polling without rebuilding an uncertain transaction', async () => {
    confirmations.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    });
    const result = expect(
      service.withSequence(source, submit),
    ).rejects.toMatchObject({ code: SorobanErrorCode.TIMEOUT });
    await jest.advanceTimersByTimeAsync(30_000);
    await result;
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('does not poll again when a domain callback already confirmed SUCCESS', async () => {
    await service.withSequence(source, () =>
      Promise.resolve({ hash: 'confirmed', status: 'SUCCESS' }),
    );
    expect(confirmations).not.toHaveBeenCalled();
  });
});

describe('Stellar result code decoding', () => {
  it('decodes SDK XDR objects and base64 XDR', () => {
    expect(extractTransactionResultCode(rejection('txBadSeq'))).toBe(
      'tx_bad_seq',
    );
    expect(
      extractTransactionResultCode(rejection('txBadSeq').toXDR('base64')),
    ).toBe('tx_bad_seq');
  });
  it.each([
    undefined,
    null,
    'malformed',
    'tx_bad_seq',
    { message: 'tx_bad_seq' },
  ])('does not infer result codes from arbitrary values: %p', (value) => {
    expect(extractTransactionResultCode(value)).toBe('unknown');
  });
});
