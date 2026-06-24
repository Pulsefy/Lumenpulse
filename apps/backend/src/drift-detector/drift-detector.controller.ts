import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  NotFoundException,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { DriftDetectorService } from './drift-detector.service';
import { DriftReport } from './entities/drift-report.entity';
import { DriftSuppression } from './entities/drift-suppression.entity';
import { SuppressDriftDto } from './dto/suppress-drift.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('drift-detector')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/drift-detector')
export class DriftDetectorController {
  constructor(private readonly driftDetectorService: DriftDetectorService) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger a full drift detection run (admin only)',
  })
  @ApiResponse({
    status: 202,
    description: 'Drift detection started',
    type: DriftReport,
  })
  async triggerDetection(): Promise<DriftReport> {
    return this.driftDetectorService.runDetection('manual');
  }

  @Get('reports')
  @ApiOperation({ summary: 'List recent drift detection reports (admin only)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'List of drift reports',
    type: [DriftReport],
  })
  async listReports(@Query('limit') limit?: number): Promise<DriftReport[]> {
    return this.driftDetectorService.getRecentReports(limit ? Number(limit) : 20);
  }

  @Get('reports/:id')
  @ApiOperation({
    summary: 'Get a specific drift report by ID (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Drift report details',
    type: DriftReport,
  })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async getReport(@Param('id') id: string): Promise<DriftReport> {
    const report = await this.driftDetectorService.getReportById(id);
    if (!report) throw new NotFoundException(`Drift report ${id} not found`);
    return report;
  }

  @Post('suppressions')
  @ApiOperation({ summary: 'Suppress a known drift (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Drift suppressed',
    type: DriftSuppression,
  })
  async suppressDrift(
    @Body() dto: SuppressDriftDto,
  ): Promise<DriftSuppression> {
    return this.driftDetectorService.suppressDrift(
      dto.entityType,
      dto.entityId,
      dto.field,
      dto.reason,
      'admin',
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
  }

  @Delete('suppressions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a drift suppression (admin only)' })
  @ApiResponse({ status: 204, description: 'Suppression removed' })
  @ApiResponse({ status: 404, description: 'Suppression not found' })
  async removeSuppression(@Body() dto: SuppressDriftDto): Promise<void> {
    const removed = await this.driftDetectorService.removeSuppression(
      dto.entityType,
      dto.entityId,
      dto.field,
    );
    if (!removed) {
      throw new NotFoundException('Suppression not found');
    }
  }

  @Get('suppressions')
  @ApiOperation({ summary: 'List all active drift suppressions (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'List of suppressions',
    type: [DriftSuppression],
  })
  async listSuppressions(): Promise<DriftSuppression[]> {
    return this.driftDetectorService.listSuppressions();
  }
}
