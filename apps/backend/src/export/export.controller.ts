import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ExportService } from './export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, UserRole } from '../auth/decorators/auth.decorators';
import { CreateExportJobDto, ExportJobResponseDto } from './dto/export-job.dto';
import { ExportStatus, ExportType } from './entities/export-job.entity';
import { ApiIdempotencyHeader } from '../common/decorators/api-idempotency.decorator';

const ANALYTICS_TYPES = new Set<ExportType>([
  ExportType.ONCHAIN_ANALYTICS,
  ExportType.ROUND_ANALYTICS,
]);

@ApiTags('exports')
@ApiBearerAuth('JWT-auth')
@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Create an async export job',
    description:
      'Queues a new export job (e.g. portfolio history or tax transactions) for the current user. The job runs asynchronously; poll GET /exports/:id for status.',
  })
  @ApiResponse({
    status: 202,
    description: 'Export job accepted and queued',
    type: ExportJobResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid export type' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Admin role required for analytics exports',
  })
  async createJob(
    @Body() dto: CreateExportJobDto,
    @Request() req: { user: { id: string; role: UserRole } },
  ): Promise<ExportJobResponseDto> {
    if (ANALYTICS_TYPES.has(dto.type) && req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Admin role required to export analytics data',
      );
    }

    const job = await this.exportService.createExportJob(req.user.id, dto.type);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Post('admin/analytics')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create an on-chain analytics CSV export (admin only)',
  })
  @ApiResponse({ status: 202, type: ExportJobResponseDto })
  @ApiResponse({ status: 403, description: 'Forbidden – admin only' })
  async createAnalyticsJob(
    @Body() dto: CreateExportJobDto,
    @Request() req: { user: { id: string } },
  ): Promise<ExportJobResponseDto> {
    if (!ANALYTICS_TYPES.has(dto.type)) {
      throw new ForbiddenException(
        `This endpoint only accepts analytics export types: ${[...ANALYTICS_TYPES].join(', ')}`,
      );
    }
    const job = await this.exportService.createExportJob(req.user.id, dto.type);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List recent export jobs for the current user',
    description:
      'Retrieves the current user’s export jobs, most recent first.',
  })
  @ApiResponse({
    status: 200,
    description: 'Export jobs retrieved successfully',
    type: [ExportJobResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async listJobs(
    @Request() req: { user: { id: string } },
  ): Promise<ExportJobResponseDto[]> {
    const jobs = await this.exportService.listJobs(req.user.id);
    return jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get export job status' })
  @ApiResponse({
    status: 200,
    description: 'Export job retrieved successfully',
    type: ExportJobResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Export job not found' })
  async getJob(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ): Promise<ExportJobResponseDto> {
    const job = await this.exportService.getJob(id, req.user.id);
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the CSV for a completed export job' })
  @ApiResponse({
    status: 200,
    description: 'CSV file download (Content-Type: text/csv)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description:
      'Export job not found, not owned by the current user, or not yet ready for download',
  })
  async downloadJob(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.exportService.getJob(id, req.user.id);

    if (job.status !== ExportStatus.COMPLETED || !job.csvData) {
      throw new NotFoundException(
        `Export job ${id} is not ready for download (status: ${job.status})`,
      );
    }

    const filename = `${job.type}_${job.createdAt.toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(job.csvData);
  }
}
