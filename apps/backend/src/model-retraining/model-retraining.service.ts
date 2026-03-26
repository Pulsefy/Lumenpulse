import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

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
  private readonly pythonApiUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.pythonApiUrl = this.configService.get<string>(
      'PYTHON_API_URL',
      'http://localhost:8000',
    );
    this.apiKey = this.configService.get<string>('PYTHON_API_KEY', '');
  }

  private get headers() {
    return this.apiKey ? { 'X-API-Key': this.apiKey } : {};
  }

  /**
   * Trigger a retraining run on the Python service.
   * @param force Skip quality gates when true.
   */
  async triggerRetraining(force = false): Promise<RetrainResult> {
    try {
      this.logger.log(`Triggering model retraining (force=${force})`);
      const response = await firstValueFrom(
        this.httpService.post<RetrainResult>(
          `${this.pythonApiUrl}/retrain`,
          { force },
          { headers: this.headers, timeout: 300_000 }, // 5 min timeout
        ),
      );
      this.logger.log(
        `Retraining completed: status=${response.data.status} ` +
          `duration=${response.data.duration_seconds?.toFixed(1)}s`,
      );
      return response.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.error(`Retraining request failed: ${msg}`);
      throw err;
    }
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
