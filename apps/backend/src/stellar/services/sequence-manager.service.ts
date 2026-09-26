import { Injectable, Logger, Optional } from '@nestjs/common';
import { Account } from '@stellar/stellar-sdk';
import { Counter, Gauge, Registry } from 'prom-client';
import {
  SorobanClientOptions,
  SorobanRpcClientService,
} from './soroban-rpc-client.service';
import {
  extractTransactionResultCode,
  isBadSequenceError,
} from '../utils/stellar-result-code';

/** Extra attempts made after a `tx_bad_seq` rejection before giving up. */
export const DEFAULT_BAD_SEQ_RETRIES = 3;

/**
 * A sequence number handed out for one submission attempt, together with the
 * pre-loaded source account to build the transaction from.
 */
export interface SequenceReservation {
  /** Source account id the sequence was reserved for. */
  publicKey: string;
  /** Pre-loaded `Account` carrying the reserved sequence number. */
  account: Account;
  /** The reserved sequence number, as a decimal string. */
  sequence: string;
  /** Releases the reservation; idempotent and safe to call in a `finally`. */
  release(): void;
}

export interface WithSequenceOptions {
  /** Extra attempts after a `tx_bad_seq` rejection. Defaults to 3. */
  maxBadSeqRetries?: number;
  /** Options forwarded to the underlying RPC reads. */
  clientOptions?: SorobanClientOptions;
}

/**
 * Serialises access to a keyed critical section. Callers for the same key run
 * one at a time, in arrival order; callers for different keys never block each
 * other. Key bookkeeping is pruned as soon as a key's queue drains.
 */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return run;
  }
}

/**
 * Allocates Stellar source-account sequence numbers from an in-process managed
 * pool guarded by a per-account lock.
 *
 * Every backend submission path (matching pool administration, treasury
 * releases, testnet bootstrap) signs with the same server key, so two
 * concurrent requests would otherwise read the same account sequence and one
 * would be rejected with `tx_bad_seq`. Reserving from the pool means each
 * caller gets a distinct, monotonically increasing sequence without paying a
 * network round-trip per submission.
 *
 * Because Stellar requires `tx.seqNum === account.seqNum + 1`, a reservation
 * that is never applied leaves a gap. {@link resync} re-reads the chain value
 * and {@link withSequence} transparently retries a `tx_bad_seq` rejection with
 * a fresh sequence, so a gap costs at most one extra attempt.
 */
@Injectable()
export class SequenceManagerService {
  private readonly logger = new Logger(SequenceManagerService.name);

  private readonly mutex = new KeyedMutex();

  /** publicKey -> next sequence number to hand out (the managed pool). */
  private readonly pool = new Map<string, string>();

  /** publicKey -> reservations handed out but not yet released. */
  private readonly inFlight = new Map<string, number>();

  private readonly allocations: Counter;
  private readonly resyncs: Counter;
  private readonly badSeqRetries: Counter;
  private readonly inFlightGauge: Gauge;

  constructor(
    private readonly sorobanRpc: SorobanRpcClientService,
    @Optional() private readonly registry?: Registry,
  ) {
    const reg = this.registry ?? new Registry();

    this.allocations = new Counter({
      name: 'stellar_sequence_allocations_total',
      help: 'Total Stellar source-account sequence numbers reserved from the managed pool',
      labelNames: ['account'],
      registers: [reg],
    });

    this.resyncs = new Counter({
      name: 'stellar_sequence_resyncs_total',
      help: 'Total times the managed sequence pool was re-synchronised from the network',
      labelNames: ['account'],
      registers: [reg],
    });

    this.badSeqRetries = new Counter({
      name: 'stellar_sequence_bad_seq_retries_total',
      help: 'Total tx_bad_seq rejections retried with a freshly allocated sequence',
      labelNames: ['account'],
      registers: [reg],
    });

    this.inFlightGauge = new Gauge({
      name: 'stellar_sequence_reservations_in_flight',
      help: 'Sequence reservations currently held for a source account',
      labelNames: ['account'],
      registers: [reg],
    });
  }

  /**
   * Reserves the next sequence number for `publicKey`. Concurrent callers for
   * the same account always receive distinct sequences; only the first call
   * after a cold cache performs a network read.
   */
  async allocate(
    publicKey: string,
    opts?: SorobanClientOptions,
  ): Promise<SequenceReservation> {
    const sequence = await this.mutex.runExclusive(publicKey, async () => {
      let next = this.pool.get(publicKey);
      if (next === undefined) {
        const account = await this.sorobanRpc.getAccount(publicKey, opts);
        next = account.sequenceNumber();
      }
      const reserved = incrementSequence(next);
      this.pool.set(publicKey, reserved);
      return reserved;
    });

    this.allocations.inc({ account: publicKey });
    this.trackInFlight(publicKey, 1);

    return {
      publicKey,
      sequence,
      account: new Account(publicKey, sequence),
      release: once(() => this.trackInFlight(publicKey, -1)),
    };
  }

  /**
   * Drops the cached cursor for `publicKey` so the next {@link allocate} reads
   * the authoritative sequence from the network.
   */
  invalidate(publicKey: string): void {
    this.pool.delete(publicKey);
  }

  /**
   * Re-reads the on-chain sequence for `publicKey` and resets the managed pool
   * to it. The cursor is never moved backwards while reservations are still in
   * flight, which would hand out a sequence that has already been used.
   */
  async resync(publicKey: string, opts?: SorobanClientOptions): Promise<string> {
    const account = await this.sorobanRpc.getAccount(publicKey, opts);
    const chainSequence = account.sequenceNumber();

    await this.mutex.runExclusive(publicKey, async () => {
      const current = this.pool.get(publicKey);
      const hasInFlight = (this.inFlight.get(publicKey) ?? 0) > 0;
      if (
        current !== undefined &&
        hasInFlight &&
        BigInt(current) > BigInt(chainSequence)
      ) {
        return;
      }
      this.pool.set(publicKey, chainSequence);
    });

    this.resyncs.inc({ account: publicKey });
    return chainSequence;
  }

  /**
   * Allocates a sequence, runs `submit`, and — if the network rejects the
   * transaction with `tx_bad_seq` — resyncs the pool and retries with a fresh
   * sequence. Non-sequence failures propagate untouched.
   */
  async withSequence<T>(
    publicKey: string,
    submit: (reservation: SequenceReservation) => Promise<T>,
    opts: WithSequenceOptions = {},
  ): Promise<T> {
    const maxBadSeqRetries = opts.maxBadSeqRetries ?? DEFAULT_BAD_SEQ_RETRIES;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxBadSeqRetries) {
      const reservation = await this.allocate(publicKey, opts.clientOptions);

      try {
        return await submit(reservation);
      } catch (error: unknown) {
        if (!isBadSequenceError(error)) {
          throw error;
        }

        lastError = error;
        attempt += 1;
        this.badSeqRetries.inc({ account: publicKey });

        this.logger.warn(
          {
            account: publicKey,
            attempt,
            maxBadSeqRetries,
            resultCode:
              extractTransactionResultCode(
                (error as { resultCode?: unknown }).resultCode,
              ) ?? undefined,
          },
          'Stellar tx_bad_seq detected; retrying with a fresh sequence',
        );

        this.invalidate(publicKey);
        try {
          await this.resync(publicKey, opts.clientOptions);
        } catch (resyncError: unknown) {
          this.logger.warn(
            {
              account: publicKey,
              error:
                resyncError instanceof Error
                  ? resyncError.message
                  : String(resyncError),
            },
            'Failed to resync sequence after tx_bad_seq; next attempt will refetch',
          );
        }
      } finally {
        reservation.release();
      }
    }

    this.logger.error(
      { account: publicKey, attempts: attempt },
      'Stellar submission kept failing with tx_bad_seq',
    );
    throw lastError ?? new Error('tx_bad_seq retries exhausted');
  }

  private trackInFlight(publicKey: string, delta: number): void {
    const next = Math.max(0, (this.inFlight.get(publicKey) ?? 0) + delta);
    if (next === 0) {
      this.inFlight.delete(publicKey);
    } else {
      this.inFlight.set(publicKey, next);
    }
    this.inFlightGauge.set({ account: publicKey }, next);
  }
}

function incrementSequence(sequence: string): string {
  return (BigInt(sequence) + 1n).toString();
}

function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) {
      return;
    }
    called = true;
    fn();
  };
}
