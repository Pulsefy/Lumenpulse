import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  IdempotencyRecord,
  IdempotencyRecordStatus,
} from './idempotency-record.entity';
import { config } from '../lib/config';

export type IdempotencyOutcome =
  | { kind: 'replay'; record: IdempotencyRecord }
  | { kind: 'hash-mismatch'; record: IdempotencyRecord }
  | { kind: 'in-progress'; record: IdempotencyRecord }
  | { kind: 'acquired'; record: IdempotencyRecord };

export interface IdempotencySettings {
  /** How long a completed key is replayed before it expires. Default 24h. */
  retentionMs?: number;
  /** How long an in_progress claim is held before it can be reclaimed. Default 60s. */
  leaseMs?: number;
  /** How long a concurrent request waits for the owner to finish. Default 30s. */
  concurrencyTimeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
  ) {}

  /** Deterministic fingerprint of method + route + body. */
  static hashRequest(method: string, route: string, body: unknown): string {
    const payload = `${method}:${route}:${body ? JSON.stringify(body) : ''}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Register this (key, method, route) for execution, serialising concurrent
   * requests with the same key:
   *
   * - nothing stored  → insert an in_progress claim and return `acquired`.
   * - completed, same hash → `replay` (return the stored response).
   * - completed, different hash → `hash-mismatch` (the key was reused).
   * - in_progress, lease alive → `in-progress` (wait for the owner).
   * - in_progress, lease expired → reclaim and become the executor.
   */
  async acquire(
    key: string,
    method: string,
    route: string,
    requestHash: string,
    settings: IdempotencySettings = {},
  ): Promise<IdempotencyOutcome> {
    const retentionMs = settings.retentionMs ?? config.idempotency.retentionMs;
    const leaseMs = settings.leaseMs ?? config.idempotency.leaseMs;
    const now = Date.now();

    const existing = await this.repo.findOne({
      where: { key, method, route },
    });
    if (existing) {
      const result = this.classify(existing, requestHash, now);
      if (result) return result;

      // Lease expired — the owner crashed or is wedged. Reclaim the key.
      this.logger.warn(
        `Reclaiming stale idempotency claim ${existing.id} for key ${key} on ${method} ${route}`,
      );
      await this.repo.delete(existing.id);
    }

    const claim = this.repo.create({
      key,
      method,
      route,
      requestHash,
      status: IdempotencyRecordStatus.IN_PROGRESS,
      responseStatus: null,
      responseBody: null,
      leaseExpiresAt: new Date(now + leaseMs),
      expiresAt: new Date(now + retentionMs),
      completedAt: null,
    });

    try {
      await this.repo.save(claim);
    } catch (err) {
      // Lost the race to a concurrent request. Re-read and classify again.
      const winner = await this.repo.findOne({
        where: { key, method, route },
      });
      if (winner) {
        const result = this.classify(winner, requestHash, Date.now());
        if (result) return result;
      }
      throw err;
    }

    return { kind: 'acquired', record: claim };
  }

  /** Store the successful response so a later request can replay it. */
  async complete(
    record: IdempotencyRecord,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.repo.save({
      ...record,
      status: IdempotencyRecordStatus.COMPLETED,
      responseStatus,
      responseBody,
      completedAt: new Date(),
    });
  }

  /** Drop an in_progress claim after a failure so the client can retry. */
  async release(recordId: string): Promise<void> {
    await this.repo.delete(recordId);
  }

  /**
   * Wait for the request that owns an in_progress claim to finish, then return
   * its completed record. Returns null if it does not complete within
   * `timeoutMs` — the caller decides how to respond.
   */
  async waitForCompletion(
    recordId: string,
    timeoutMs: number = config.idempotency.concurrencyTimeoutMs,
  ): Promise<IdempotencyRecord | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const record = await this.repo.findOne({ where: { id: recordId } });
      if (record?.status === IdempotencyRecordStatus.COMPLETED) {
        return record;
      }
      if (Date.now() >= deadline) return null;
      await sleep(100);
    }
  }

  /**
   * Delete records that are no longer needed: completed records past their
   * retention window and in_progress claims past their lease. Runs on the
   * documented cleanup schedule (see `IdempotencyScheduler`).
   */
  async cleanupExpired(now: Date = new Date()): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('"expiresAt" < :now', { now })
      .orWhere('"status" = :status AND "leaseExpiresAt" < :now', {
        status: IdempotencyRecordStatus.IN_PROGRESS,
        now,
      })
      .execute();
    return result.affected ?? 0;
  }

  private classify(
    record: IdempotencyRecord,
    requestHash: string,
    now: number,
  ): IdempotencyOutcome | null {
    // Retention window elapsed — treat as reclaimable so a late retry starts a
    // fresh operation instead of replaying a stale response.
    if (record.expiresAt.getTime() <= now) {
      return null;
    }
    if (record.status === IdempotencyRecordStatus.COMPLETED) {
      if (record.requestHash === requestHash) {
        return { kind: 'replay', record };
      }
      return { kind: 'hash-mismatch', record };
    }
    if (record.leaseExpiresAt.getTime() > now) {
      return { kind: 'in-progress', record };
    }
    return null;
  }
}
