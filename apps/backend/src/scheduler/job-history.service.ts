import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobRun, JobRunStatus } from './entities/job-run.entity';

@Injectable()
export class JobHistoryService {
  constructor(
    @InjectRepository(JobRun)
    private readonly repo: Repository<JobRun>,
  ) {}

  /** Create a RUNNING record and return it so callers can update it later. */
  async start(jobName: string, triggeredBy = 'scheduled'): Promise<JobRun> {
    const run = this.repo.create({ jobName, triggeredBy, status: JobRunStatus.RUNNING });
    return this.repo.save(run);
  }

  /** Mark a run as SKIPPED (lock was held). */
  async markSkipped(jobName: string): Promise<void> {
    const run = this.repo.create({
      jobName,
      status: JobRunStatus.SKIPPED,
      finishedAt: new Date(),
      durationMs: 0,
    });
    await this.repo.save(run);
  }

  /** Mark an existing run as COMPLETED with an optional result payload. */
  async complete(
    run: JobRun,
    result?: Record<string, unknown>,
  ): Promise<void> {
    run.status = JobRunStatus.COMPLETED;
    run.result = result ?? null;
    run.finishedAt = new Date();
    run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
    await this.repo.save(run);
  }

  /** Mark an existing run as FAILED with an error message. */
  async fail(run: JobRun, error: unknown): Promise<void> {
    run.status = JobRunStatus.FAILED;
    run.errorMessage = error instanceof Error ? error.message : String(error);
    run.finishedAt = new Date();
    run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
    await this.repo.save(run);
  }

  /** Fetch the N most recent runs for a given job name. */
  async getHistory(jobName: string, limit = 20): Promise<JobRun[]> {
    return this.repo.find({
      where: { jobName },
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  /** Fetch the last run for a given job name. */
  async getLastRun(jobName: string): Promise<JobRun | null> {
    return this.repo.findOne({
      where: { jobName },
      order: { startedAt: 'DESC' },
    });
  }
}
