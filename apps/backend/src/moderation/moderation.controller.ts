import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  Query,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ModerationService } from './moderation.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';
import { ContentReport, ReportStatus } from './entities/content-report.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

// Unified Authenticated Request Interface
interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('moderation')
@ApiBearerAuth('JWT-auth')
@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // ─── USER ENDPOINTS ───────────────────────────────────────────────────

  @Post('report')
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a content report' })
  @ApiResponse({
    status: 201,
    description: 'Report successfully created',
    type: ContentReport,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - duplicate report or invalid data',
  })
  async createReport(
    @Req() req: RequestWithUser,
    @Body() createReportDto: CreateReportDto,
  ) {
    return this.moderationService.createReport(req.user.id, createReportDto);
  }

  @Get('my-reports')
  @ApiOperation({ summary: 'Get reports submitted by current user' })
  @ApiResponse({ status: 200, description: 'List of user reports' })
  async getMyReports(
    @Req() req: RequestWithUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moderationService.getUserReports(
      req.user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  // ─── ADMIN/MODERATOR ENDPOINTS ────────────────────────────────────────

  @Get('queue')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get moderation queue (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'List of all reports with pagination',
  })
  async getModerationQueue(@Query() query: QueryReportsDto) {
    return this.moderationService.getReports(query);
  }

  @Get('queue/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get moderation statistics (Admin only)' })
  @ApiResponse({ status: 200, description: 'Moderation queue statistics' })
  async getModerationStats() {
    return this.moderationService.getModerationStats();
  }

  @Get('queue/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get specific report details (Admin only)' })
  @ApiResponse({ status: 200, description: 'Report details' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async getReport(@Param('id') id: string) {
    return this.moderationService.getReportById(id);
  }

  @Patch('queue/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Update report status (Admin only)' })
  @ApiResponse({ status: 200, description: 'Report updated successfully' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async updateReport(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() updateReportDto: UpdateReportDto,
  ) {
    return this.moderationService.updateReport(
      id,
      req.user.id,
      updateReportDto,
    );
  }

  @Post('queue/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Apply independent moderation updates in bulk' })
  async updateReportsBulk(
    @Req() req: RequestWithUser,
    @Body() body: { items: Array<{ id: string; update: UpdateReportDto }> },
  ) {
    const items = body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      throw new BadRequestException('items must contain between 1 and 50 updates');
    }
    const ids = items.map((item) => item?.id);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each item must have a unique report id');
    }
    if (items.some((item) => !item || !item.update || typeof item.update !== 'object' ||
      Array.isArray(item.update) ||
      (item.update.status !== undefined && !Object.values(ReportStatus).includes(item.update.status)) ||
      (item.update.reviewNotes !== undefined && (typeof item.update.reviewNotes !== 'string' || item.update.reviewNotes.length > 2000)))) {
      throw new BadRequestException('Each update must contain a valid status and reviewNotes value');
    }

    const bulkOperationId = randomUUID();
    const results = await Promise.all(items.map(async (item) => {
      try {
        const value = await this.moderationService.updateReport(
          item.id, req.user.id, item.update, bulkOperationId,
        );
        return { id: item.id, success: true, value };
      } catch (error) {
        await this.moderationService.recordBulkItemFailure(
          req.user.id,
          bulkOperationId,
          item.id,
          error instanceof Error ? error.message : 'Update failed',
        );
        return { id: item.id, success: false, error: error instanceof Error ? error.message : 'Update failed' };
      }
    }));
    return { bulkOperationId, results };
  }

  @Post('queue/assign/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Assign reviewers to reports independently in bulk' })
  async assignReviewersBulk(
    @Req() req: RequestWithUser,
    @Body() body: { items: Array<{ id: string; reviewerId?: string | null }> },
  ) {
    const items = body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      throw new BadRequestException('items must contain between 1 and 50 assignments');
    }
    const ids = items.map((item) => item?.id);
    if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each item must have a unique report id');
    }
    if (items.some((item) => !item || (item.reviewerId !== undefined && item.reviewerId !== null && typeof item.reviewerId !== 'string'))) {
      throw new BadRequestException('Each reviewerId must be a string or null');
    }

    const bulkOperationId = randomUUID();
    const results = await Promise.all(items.map(async (item) => {
      try {
        const value = await this.moderationService.assignReviewer(
          item.id,
          req.user.id,
          item.reviewerId ?? undefined,
          bulkOperationId,
        );
        return { id: item.id, success: true, value };
      } catch (error) {
        await this.moderationService.recordBulkItemFailure(
          req.user.id,
          bulkOperationId,
          item.id,
          error instanceof Error ? error.message : 'Assignment failed',
        );
        return { id: item.id, success: false, error: error instanceof Error ? error.message : 'Assignment failed' };
      }
    }));
    return { bulkOperationId, results };
  }

  @Patch('queue/:id/assign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @ApiOperation({ summary: 'Assign a reviewer to a report (Admin only)' })
  @ApiResponse({ status: 200, description: 'Reviewer assigned successfully' })
  @ApiResponse({ status: 404, description: 'Report not found' })
  async assignReviewer(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() assignReviewerDto: AssignReviewerDto,
  ) {
    return this.moderationService.assignReviewer(
      id,
      req.user.id,
      assignReviewerDto.reviewerId,
    );
  }
}
