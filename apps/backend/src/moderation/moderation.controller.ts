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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

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
  @ApiResponse({ status: 201, description: 'Report successfully created' })
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
}
