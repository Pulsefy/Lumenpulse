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
import { CreateExportJobDto, ExportJobResponseDto } from './dto/export-job.dto';
import { ExportStatus } from './entities/export-job.entity';

@ApiTags('exports')
@ApiBearerAuth('JWT-auth')
@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Create an async export job' })
  @ApiResponse({ status: 202, type: ExportJobResponseDto })
  async createJob(
    @Body() dto: CreateExportJobDto,
    @Request() req: { user: { id: string } },
  ): Promise<ExportJobResponseDto> {
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
  @ApiOperation({ summary: 'List recent export jobs for the current user' })
  @ApiResponse({ status: 200, type: [ExportJobResponseDto] })
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
  @ApiResponse({ status: 200, type: ExportJobResponseDto })
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
  @ApiResponse({ status: 200, description: 'CSV file download' })
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
