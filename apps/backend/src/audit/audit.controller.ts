import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogQueryDto, AuditLogListResponseDto, AuditLogDto } from './dto/audit-log.dto';
import { AuditAction } from './entities/audit-log.entity';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('audit')
@ApiBearerAuth('JWT-auth')
@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @ApiOperation({
    summary: 'Get audit logs with filtering and pagination',
    description: 'Retrieve audit logs with optional filtering by user, action type, and date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of audit logs retrieved successfully',
    type: AuditLogListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: AuditAction,
    description: 'Filter by action type',
  })
  @ApiQuery({ name: 'startDate', required: false, description: 'Filter by start date (ISO 8601)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Filter by end date (ISO 8601)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', type: Number })
  async getAuditLogs(
    @Query() query: AuditLogQueryDto,
  ): Promise<AuditLogListResponseDto> {
    return this.auditService.getAuditLogs(query);
  }

  @Get('my-activity')
  @ApiOperation({
    summary: 'Get current user audit activity',
    description: 'Retrieve audit logs for the currently authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User activity retrieved successfully',
    type: AuditLogListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number', type: Number })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page', type: Number })
  async getMyActivity(
    @Req() req: RequestWithUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<AuditLogListResponseDto> {
    return this.auditService.getUserAuditLogs(
      req.user.id,
      page || 1,
      limit || 20,
    );
  }

  @Get('my-activity/recent')
  @ApiOperation({
    summary: 'Get recent activity for current user',
    description: 'Retrieve the most recent audit log entries for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Recent user activity retrieved successfully',
    type: [AuditLogDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of items to return', type: Number })
  async getMyRecentActivity(
    @Req() req: RequestWithUser,
    @Query('limit') limit?: number,
  ): Promise<AuditLogDto[]> {
    return this.auditService.getRecentUserActivity(req.user.id, limit || 10);
  }
}
