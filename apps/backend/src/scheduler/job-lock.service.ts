import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Distributed job locking via PostgreSQL advisory locks.
 *
 * pg_try_advisory_lock(key) is session-scoped: the lock is automatically
 * released when the DB connection closes, so a crashed process can never
 * leave a lock permanently held.
 *
 * Keys are derived from a stable hash of the job name so they are
 * consistent across restarts and deployments.
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Try to acquire an advisory lock for the given job name.
   * Returns true if the lock was acquired (safe to run), false if another
   * instance already holds it (skip this run).
   */
  async tryAcquire(jobName: string): Promise<boolean> {
    const key = this.nameToKey(jobName);
    const result = await this.dataSource.query<[{ pg_try_advisory_lock: boolean }]>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
      [key],
    );
    const acquired = result[0]?.pg_try_advisory_lock === true;
    if (!acquired) {
      this.logger.warn(`Job "${jobName}" skipped — lock held by another instance`);
    }
    return acquired;
  }

  /**
   * Release the advisory lock for the given job name.
   * Safe to call even if the lock is not held.
   */
  async release(jobName: string): Promise<void> {
    const key = this.nameToKey(jobName);
    await this.dataSource.query('SELECT pg_advisory_unlock($1)', [key]);
  }

  /**
   * Convenience wrapper: acquire → run fn → release.
   * Returns null when the lock could not be acquired (another instance running).
   */
  async withLock<T>(
    jobName: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const acquired = await this.tryAcquire(jobName);
    if (!acquired) return null;
    try {
      return await fn();
    } finally {
      await this.release(jobName);
    }
  }

  /**
   * Convert a job name string to a stable 32-bit integer key.
   * Uses a simple djb2-style hash — collision probability is negligible
   * for the small number of job names in this application.
   */
  private nameToKey(jobName: string): number {
    let hash = 5381;
    for (let i = 0; i < jobName.length; i++) {
      hash = ((hash << 5) + hash) ^ jobName.charCodeAt(i);
      hash = hash >>> 0; // keep unsigned 32-bit
    }
    // pg advisory lock keys are bigint; cast to signed 32-bit to stay safe
    return hash | 0;
  }
}
