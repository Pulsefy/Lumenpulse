import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReadModelRebuildService } from './read-model-rebuild.service';
import { RebuildRequestDto } from './dto/rebuild-request.dto';
import {
  RebuildResponseDto,
  RebuildStatusResponseDto,
  RebuildTriggerResponseDto,
} from './dto/rebuild-response.dto';
import {
  RebuildDataset,
  RebuildStatus,
} from './entities/read-model-rebuild-job.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, UserRole } from '../auth/decorators/auth.decorators';

interface AuthenticatedRequest {
  user: { userId?: string; sub?: string };
}

@ApiTags('Read Model Rebuild')
@ApiBearerAuth()
@Controller('api/read-model')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReadModelRebuildController {
  private readonly logger = new Logger(ReadModelRebuildController.name);

  constructor(private readonly rebuildService: ReadModelRebuildService) {}

  @Post('rebuild')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Trigger a read-model rebuild',
    description:
      'Admin-only endpoint to rebuild derived datasets when ingestion logic changes',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Rebuild job started',
    type: RebuildTriggerResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Rebuild already in progress for this dataset/contract',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Admin access required',
  })
  async triggerRebuild(
    @Body() dto: RebuildRequestDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RebuildTriggerResponseDto> {
    const userId = req.user?.userId || req.user?.sub || 'unknown';

    this.logger.log(
      `Rebuild requested by ${userId} for dataset=${dto.dataset}, contract=${dto.contractId || 'all'}`,
    );

    return this.rebuildService.triggerRebuild(dto, userId);
  }

  @Get('jobs/:jobId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get rebuild job status',
    description: 'Get detailed status of a rebuild job including progress',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Job status retrieved',
    type: RebuildStatusResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Job not found',
  })
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<RebuildStatusResponseDto> {
    return this.rebuildService.getJobStatus(jobId);
  }

  @Get('jobs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List rebuild jobs',
    description: 'List recent rebuild jobs with optional filters',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Jobs retrieved',
    type: [RebuildResponseDto],
  })
  async listJobs(
    @Query('dataset') dataset?: RebuildDataset,
    @Query('status') status?: RebuildStatus,
    @Query('limit') limit?: string,
  ): Promise<RebuildResponseDto[]> {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.rebuildService.listJobs(dataset, status, limitNum);
  }

  @Delete('jobs/:jobId/cancel')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a rebuild job',
    description: 'Cancel a pending or in-progress rebuild job',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Job cancelled',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Job not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot cancel completed/failed job',
  })
  async cancelJob(
    @Param('jobId') jobId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user?.userId || req.user?.sub || 'unknown';
    return this.rebuildService.cancelJob(jobId, userId);
  }

  @Delete('jobs/cleanup')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clean up old jobs',
    description:
      'Delete completed/failed/cancelled jobs older than specified days',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Jobs cleaned up',
  })
  async cleanupJobs(
    @Query('olderThanDays') olderThanDays?: string,
  ): Promise<{ deleted: number }> {
    const days = olderThanDays ? parseInt(olderThanDays, 10) : 30;
    return this.rebuildService.cleanupJobs(days);
  }

  @Get('datasets')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List available datasets',
    description: 'Get list of datasets that can be rebuilt',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Datasets listed',
  })
  listDatasets(): {
    datasets: { name: string; description: string }[];
  } {
    return {
      datasets: [
        {
          name: RebuildDataset.KPI_SNAPSHOTS,
          description: 'Daily KPI snapshots (TVL, Volume)',
        },
        {
          name: RebuildDataset.PROJECT_VIEWS,
          description: 'Aggregated project views',
        },
        {
          name: RebuildDataset.CONTRACT_EVENTS,
          description: 'Contract event materialization',
        },
        {
          name: RebuildDataset.DAILY_METRICS,
          description: 'Daily metric aggregates',
        },
        {
          name: RebuildDataset.ALL,
          description: 'All datasets (full rebuild)',
        },
      ],
    };
  }
}
