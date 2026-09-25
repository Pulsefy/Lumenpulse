import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import {
  ModelRetrainingService,
  ModelStatusResult,
  JobSubmission,
  JobStatus,
} from './model-retraining.service';

class TriggerRetrainDto {
  @ApiPropertyOptional({
    description: 'Whether to force retrain regardless of new data thresholds',
    example: true,
  })
  force?: boolean;
}

class JobSubmissionDto implements JobSubmission {
  @ApiProperty({
    description: 'Identifier of the submitted job; poll it for the outcome',
    example: 'b3f1c2a4-...',
  })
  job_id: string;

  @ApiProperty({ description: 'Type of job submitted', example: 'retrain' })
  job_type: string;

  @ApiProperty({
    description:
      'queued, or the status of an already in-flight job this submission collapsed onto',
    example: 'queued',
  })
  status: string;

  @ApiProperty({
    description:
      'False when this collapsed onto an already in-flight duplicate',
    example: true,
  })
  created: boolean;
}

class JobStatusDto implements JobStatus {
  @ApiProperty({ example: 'b3f1c2a4-...' })
  job_id: string;

  @ApiProperty({ example: 'retrain' })
  job_type: string;

  @ApiProperty({ example: 'succeeded' })
  status: 'queued' | 'running' | 'succeeded' | 'failed';

  @ApiPropertyOptional({ description: 'Submission parameters', example: {} })
  params?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Result payload once the job has succeeded',
    example: { status: 'completed', duration_seconds: 60.5 },
  })
  result?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description: 'Error message if failed',
    example: null,
  })
  error?: string | null;

  @ApiPropertyOptional({ example: '2026-05-27T20:58:35Z' })
  created_at?: string | null;

  @ApiPropertyOptional({ example: '2026-05-27T20:58:36Z' })
  started_at?: string | null;

  @ApiPropertyOptional({ example: '2026-05-27T20:59:35Z' })
  finished_at?: string | null;
}

class ModelStatusResultDto implements ModelStatusResult {
  @ApiProperty({
    description: 'Metadata of the last training run',
    example: { status: 'success' },
  })
  last_run: Record<string, unknown>;

  @ApiProperty({
    description: 'Status of the model registry',
    example: { active_version: 'v2' },
  })
  registry: Record<string, unknown>;
}

/**
 * Admin-only endpoints for model retraining management.
 * All routes require JWT + ADMIN role.
 */
@ApiTags('admin-models')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/models')
export class ModelRetrainingController {
  constructor(private readonly retrainingService: ModelRetrainingService) {}

  /**
   * POST /admin/models/retrain
   * Submit a model retraining run to the async job queue (#1248) and
   * return immediately with a job identifier.
   * Body: { force?: boolean }
   */
  @Post('retrain')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a model retraining run (admin only)',
    description:
      "Submits retraining to the data-processing service's async job queue and returns a job_id immediately. Poll GET /admin/models/retrain/:jobId for the outcome.",
  })
  @ApiResponse({
    status: 202,
    description: 'Model retraining submitted',
    type: JobSubmissionDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async triggerRetrain(
    @Body() body: TriggerRetrainDto,
  ): Promise<JobSubmission> {
    return this.retrainingService.triggerRetraining(body.force ?? false);
  }

  /**
   * GET /admin/models/retrain/:jobId
   * Poll the status/result of a retraining job.
   */
  @Get('retrain/:jobId')
  @ApiOperation({
    summary: 'Get retraining job status (admin only)',
    description:
      'Reports queued/running/succeeded/failed for a job submitted via POST /admin/models/retrain.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job status retrieved successfully',
    type: JobStatusDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getRetrainJob(@Param('jobId') jobId: string): Promise<JobStatus> {
    return this.retrainingService.getJobStatus(jobId);
  }

  /**
   * GET /admin/models/status
   * Return current model registry state and last retraining run metadata.
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get model retraining status (admin only)',
    description:
      'Retrieves metadata about current registry states and last retraining outputs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Model status retrieved successfully',
    type: ModelStatusResultDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getStatus(): Promise<ModelStatusResult> {
    return this.retrainingService.getModelStatus();
  }
}
