import { ExportJob, ExportType, CreateExportJobRequest } from '@/types/export';

export class ExportApiService {
  private static readonly BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  /**
   * Request a new export job
   */
  static async createExportJob(
    type: ExportType,
    token: string,
  ): Promise<ExportJob> {
    const response = await fetch(`${this.BASE_URL}/exports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ type } as CreateExportJobRequest),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to create export job');
    }

    const data = await response.json();
    return this.normalizeExportJob(data);
  }

  /**
   * Get all export jobs for the current user
   */
  static async listExportJobs(token: string): Promise<ExportJob[]> {
    const response = await fetch(`${this.BASE_URL}/exports`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to fetch export jobs');
    }

    const data = await response.json();
    return Array.isArray(data) ? data.map((job) => this.normalizeExportJob(job)) : [];
  }

  /**
   * Get a single export job by ID
   */
  static async getExportJob(jobId: string, token: string): Promise<ExportJob> {
    const response = await fetch(`${this.BASE_URL}/exports/${jobId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to fetch export job');
    }

    const data = await response.json();
    return this.normalizeExportJob(data);
  }

  /**
   * Download the CSV for a completed export job
   * Returns a Blob containing the file data
   */
  static async downloadExportJob(jobId: string, token: string): Promise<Blob> {
    const response = await fetch(`${this.BASE_URL}/exports/${jobId}/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to download export job');
    }

    return response.blob();
  }

  /**
   * Normalize export job dates from strings to Date objects
   */
  private static normalizeExportJob(job: any): ExportJob {
    return {
      ...job,
      createdAt: typeof job.createdAt === 'string' ? new Date(job.createdAt) : job.createdAt,
      updatedAt: typeof job.updatedAt === 'string' ? new Date(job.updatedAt) : job.updatedAt,
    };
  }
}
