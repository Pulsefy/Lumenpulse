const mockConfig = {
  stellar: {
    network: 'testnet' as const,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    timeout: 3000,
    simulationTraceLevel: 'summary' as 'off' | 'summary' | 'verbose',
  },
};

jest.mock('../../lib/config', () => ({
  config: mockConfig,
}));

import { Account, Keypair } from '@stellar/stellar-sdk';
import { Registry } from 'prom-client';
import type { SorobanRpcClientService } from './soroban-rpc-client.service';
import {
  DEFAULT_BAD_SEQ_RETRIES,
  SequenceManagerService,
} from './sequence-manager.service';

const SOURCE = Keypair.random().publicKey();

/** Error shape produced by `SorobanRpcClientService.sendTransaction` on `tx_bad_seq`. */
const badSeqError = () =>
  Object.assign(new Error('Transaction submission failed: tx_bad_seq'), {
    code: 'SOROBAN_SUBMISSION_BAD_SEQUENCE',
    resultCode: 'tx_bad_seq',
  });

describe('SequenceManagerService', () => {
  let getAccount: jest.Mock;
  let service: SequenceManagerService;

  const buildService = (chainSequence = '100') => {
    getAccount = jest.fn(async () => new Account(SOURCE, chainSequence));
    service = new SequenceManagerService(
      { getAccount } as unknown as SorobanRpcClientService,
      new Registry(),
    );
    return service;
  };

  beforeEach(() => {
    buildService();
  });

  describe('managed pool', () => {
    it('hands a unique sequence to every concurrent reservation', async () => {
      const reservations = await Promise.all(
        Array.from({ length: 25 }, () => service.allocate(SOURCE)),
      );

      const sequences = reservations.map((r) => r.sequence);
      expect(new Set(sequences).size).toBe(25);
      expect(sequences[0]).toBe('101');
      expect(sequences[24]).toBe('125');
      // the managed pool means only one network read for the whole wave
      expect(getAccount).toHaveBeenCalledTimes(1);
    });

    it('reproduces contention reliably: two simultaneous callers never share a sequence', async () => {
      // Emulate the pre-fix race: both callers would read the same chain
      // sequence if allocation were not serialised.
      let resolveAccount!: (account: Account) => void;
      getAccount = jest.fn(
        () =>
          new Promise<Account>((resolve) => {
            resolveAccount = resolve;
          }),
      );
      service = new SequenceManagerService(
        { getAccount } as unknown as SorobanRpcClientService,
        new Registry(),
      );

      const first = service.allocate(SOURCE);
      const second = service.allocate(SOURCE);

      // Only after both callers are queued does the single network read settle.
      resolveAccount(new Account(SOURCE, '500'));

      const [a, b] = await Promise.all([first, second]);
      expect(a.sequence).toBe('501');
      expect(b.sequence).toBe('502');
      expect(a.sequence).not.toBe(b.sequence);
      expect(getAccount).toHaveBeenCalledTimes(1);
    });

    it('fans in-flight tracking out and back to zero on release', async () => {
      const registry = new Registry();
      service = new SequenceManagerService(
        { getAccount } as unknown as SorobanRpcClientService,
        registry,
      );

      const a = await service.allocate(SOURCE);
      const b = await service.allocate(SOURCE);
      expect(await registry.metrics()).toContain(
        `stellar_sequence_reservations_in_flight{account="${SOURCE}"} 2`,
      );

      a.release();
      a.release(); // idempotent
      b.release();

      expect(await registry.metrics()).toContain(
        `stellar_sequence_reservations_in_flight{account="${SOURCE}"} 0`,
      );
    });

    it('re-reads the chain sequence after invalidate()', async () => {
      await service.allocate(SOURCE);
      service.invalidate(SOURCE);

      getAccount.mockResolvedValueOnce(new Account(SOURCE, '900'));
      const reservation = await service.allocate(SOURCE);

      expect(reservation.sequence).toBe('901');
      expect(getAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('tx_bad_seq handling', () => {
    it('retries with a freshly resynced sequence when the network moved ahead', async () => {
      getAccount
        .mockResolvedValueOnce(new Account(SOURCE, '100'))
        .mockResolvedValueOnce(new Account(SOURCE, '150'));

      const observed: string[] = [];
      let attempts = 0;

      const result = await service.withSequence(SOURCE, async ({ sequence }) => {
        observed.push(sequence);
        attempts += 1;
        if (attempts === 1) {
          throw badSeqError();
        }
        return 'submitted';
      });

      expect(result).toBe('submitted');
      expect(attempts).toBe(2);
      // second attempt no longer reuses the stale sequence
      expect(observed).toEqual(['101', '151']);
    });

    it('does not retry unrelated submission failures', async () => {
      const failure = Object.assign(new Error('Transaction submission failed'), {
        code: 'SOROBAN_SUBMISSION_FAILED',
        resultCode: 'tx_insufficient_fee',
      });

      let attempts = 0;
      await expect(
        service.withSequence(SOURCE, async () => {
          attempts += 1;
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(attempts).toBe(1);
    });

    it('stops after the configured retry budget and surfaces the last error', async () => {
      let attempts = 0;
      const error = badSeqError();

      await expect(
        service.withSequence(
          SOURCE,
          async () => {
            attempts += 1;
            throw error;
          },
          { maxBadSeqRetries: 2 },
        ),
      ).rejects.toBe(error);

      // one initial attempt plus two retries
      expect(attempts).toBe(3);
    });

    it('defaults to a bounded retry budget', () => {
      expect(DEFAULT_BAD_SEQ_RETRIES).toBeGreaterThan(0);
    });

    it('releases the reservation even when the submission fails', async () => {
      const registry = new Registry();
      service = new SequenceManagerService(
        { getAccount } as unknown as SorobanRpcClientService,
        registry,
      );

      await expect(
        service.withSequence(
          SOURCE,
          async () => {
            throw new Error('boom');
          },
          { maxBadSeqRetries: 0 },
        ),
      ).rejects.toThrow('boom');

      expect(await registry.metrics()).toContain(
        `stellar_sequence_reservations_in_flight{account="${SOURCE}"} 0`,
      );
    });
  });
});
