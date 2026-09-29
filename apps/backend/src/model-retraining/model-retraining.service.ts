import { Injectable, Logger } from '@nestjs/common';
import { DataProcessingClientService } from '../data-processing/data-processing-client.service';

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

@Injectable()
export class ModelRetrainingService {
  private readonly logger = new Logger(ModelRetrainingService.name);

  constructor(private readonly dataProcessing: DataProcessingClientService) {}

  /**
   * Trigger a retraining run on the Python service.
   * @param force Skip quality gates when true.
   */
  async triggerRetraining(force = false): Promise<RetrainResult> {
    try {
      this.logger.log(`Triggering model retraining (force=${force})`);
      const result = await this.dataProcessing.post<RetrainResult>(
        '/retrain',
        { force },
        { timeoutMs: 300_000, maxRetries: 0 },
      );
      this.logger.log(
        `Retraining completed: status=${result.status} ` +
          `duration=${result.duration_seconds?.toFixed(1)}s`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `Retraining request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  /**
   * Fetch current model registry state and last run metadata.
   */
  async getModelStatus(): Promise<ModelStatusResult> {
    try {
      return await this.dataProcessing.get<ModelStatusResult>(
        '/model/status',
        { timeoutMs: 10_000 },
      );
    } catch (err) {
      this.logger.error(
        `Model status request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
