import {
  Controller,
  Post,
  Get,
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
  RetrainResult,
  ModelStatusResult,
} from './model-retraining.service';

class TriggerRetrainDto {
  @ApiPropertyOptional({
    description: 'Whether to force retrain regardless of new data thresholds',
    example: true,
  })
  force?: boolean;
}

class RetrainResultDto implements RetrainResult {
  @ApiProperty({
    description: 'Status message of the retrain trigger',
    example: 'Retraining initiated',
  })
  status: string;

  @ApiPropertyOptional({
    description: 'Retraining started timestamp',
    example: '2026-05-27T20:58:35Z',
  })
  started_at?: string;

  @ApiPropertyOptional({
    description: 'Retraining finished timestamp',
    example: '2026-05-27T20:59:35Z',
  })
  finished_at?: string;

  @ApiPropertyOptional({
    description: 'Retraining duration in seconds',
    example: 60.5,
  })
  duration_seconds?: number;

  @ApiPropertyOptional({
    description: 'Summary of models generated',
    example: { sentiment: 'v2' },
  })
  models?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Summary of registry updates',
    example: { active_version: 'v2' },
  })
  registry?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Error message if failed', example: '' })
  error?: string;
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
   * Trigger an immediate model retraining run.
   * Body: { force?: boolean }
   */
  @Post('retrain')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger model retraining (admin only)',
    description:
      'Triggers a background task to retrain the sentiment analysis model.',
  })
  @ApiResponse({
    status: 200,
    description: 'Model retraining triggered successfully',
    type: RetrainResultDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async triggerRetrain(
    @Body() body: TriggerRetrainDto,
  ): Promise<RetrainResult> {
    return this.retrainingService.triggerRetraining(body.force ?? false);
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
