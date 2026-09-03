import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { config } from '../lib/config';

export interface RetrainResult {
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_seconds?: number;
  models?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  error?: string;
}

export interface ModelStatusResult {
  last_run: Record<string, unknown>;
  registry: Record<string, unknown>;
}

/** Returned immediately by the Python service's async job endpoints (#1248). */
export interface JobSubmission {
  job_id: string;
  job_type: string;
  status: string;
  created: boolean;
}

export interface JobStatus {
  job_id: string;
  job_type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  params?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed']);

@Injectable()
export class ModelRetrainingService {
  private readonly logger = new Logger(ModelRetrainingService.name);
  private readonly pythonApiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pythonApiUrl =
      this.configService.get<string>('PYTHON_API_URL') || config.python.apiUrl;
    this.apiKey =
      this.configService.get<string>('PYTHON_API_KEY') ||
      config.python.apiKey ||
      '';
  }

  private get headers() {
    return this.apiKey ? { 'X-API-Key': this.apiKey } : {};
  }

  /**
   * Submit a retraining run to the Python service's async job queue (#1248).
   * Returns immediately with a job identifier — the Python side runs
   * retraining in the background, so this no longer holds a single HTTP
   * connection open for the duration of the run.
   * @param force Skip quality gates when true.
   */
  async triggerRetraining(force = false): Promise<JobSubmission> {
    try {
      this.logger.log(`Submitting model retraining (force=${force})`);
      const response = await firstValueFrom(
        this.httpService.post<JobSubmission>(
          `${this.pythonApiUrl}/retrain`,
          { force },
          { headers: this.headers, timeout: 10_000 },
        ),
      );
      this.logger.log(
        `Retraining submitted: job_id=${response.data.job_id} status=${response.data.status}`,
      );
      return response.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.error(`Retraining submission failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Poll the status of a job submitted to the Python service's job queue.
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await firstValueFrom(
      this.httpService.get<JobStatus>(
        `${this.pythonApiUrl}/api/jobs/${jobId}`,
        { headers: this.headers, timeout: 10_000 },
      ),
    );
    return response.data;
  }

  /**
   * Submit a retraining run and poll until it reaches a terminal state,
   * instead of blocking on a single long-lived HTTP request. Used by
   * callers (e.g. the daily scheduler) that need the final result.
   */
  async triggerRetrainingAndWait(
    force = false,
    { pollIntervalMs = 5_000, timeoutMs = 1_800_000 } = {},
  ): Promise<RetrainResult> {
    const submission = await this.triggerRetraining(force);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.getJobStatus(submission.job_id);
      if (TERMINAL_STATUSES.has(job.status)) {
        if (job.status === 'failed') {
          return { status: 'failed', error: job.error ?? 'Unknown error' };
        }
        return (
          (job.result as unknown as RetrainResult) ?? { status: 'succeeded' }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Retraining job ${submission.job_id} did not finish within ${timeoutMs}ms; ` +
        `it may still be running — check GET /admin/models/retrain/${submission.job_id}`,
    );
  }

  /**
   * Fetch current model registry state and last run metadata.
   */
  async getModelStatus(): Promise<ModelStatusResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<ModelStatusResult>(
          `${this.pythonApiUrl}/model/status`,
          { headers: this.headers, timeout: 10_000 },
        ),
      );
      return response.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.error(`Model status request failed: ${msg}`);
      throw err;
    }
  }
}
