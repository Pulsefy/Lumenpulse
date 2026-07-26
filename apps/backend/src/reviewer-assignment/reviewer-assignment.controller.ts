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
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ReviewerAssignmentService } from './reviewer-assignment.service';
import { AssignSubmissionDto } from './dto/assign-submission.dto';
import { UnassignSubmissionDto } from './dto/unassign-submission.dto';
import { UpdateAssignmentStateDto } from './dto/update-assignment-state.dto';
import { QueryTriageQueueDto } from './dto/query-triage-queue.dto';
import { AssignmentResponseDto, TriageQueueResponseDto, AuditLogResponseDto } from './dto/assignment-response.dto';
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

@ApiTags('reviewer-assignment')
@ApiBearerAuth('JWT-auth')
@Controller('reviewer-assignment')
@UseGuards(JwtAuthGuard)
export class ReviewerAssignmentController {
  constructor(
    private readonly reviewerAssignmentService: ReviewerAssignmentService,
  ) {}

  /**
   * Assign a submission to a reviewer
   */
  @Post('assign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign submission to a reviewer (Admin only)' })
  @ApiResponse({
    status: 201,
    description: 'Submission successfully assigned',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid state transition or bad request',
  })
  @ApiResponse({
    status: 404,
    description: 'Reviewer not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - assignment already exists or state mismatch',
  })
  async assignSubmission(
    @Req() req: RequestWithUser,
    @Body() assignDto: AssignSubmissionDto,
  ): Promise<AssignmentResponseDto> {
    const assignment = await this.reviewerAssignmentService.assignSubmission(
      assignDto,
      req.user.id,
      req.user.email,
    );

    return this.mapToResponseDto(assignment);
  }

  /**
   * Reassign a submission to a different reviewer
   */
  @Patch('reassign/:itemId/:itemType')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reassign submission to a different reviewer (Admin only)',
  })
  @ApiParam({ name: 'itemId', description: 'UUID of the item' })
  @ApiParam({ name: 'itemType', description: 'Type of the item' })
  @ApiResponse({
    status: 200,
    description: 'Submission successfully reassigned',
  })
  @ApiResponse({
    status: 404,
    description: 'Assignment or reviewer not found',
  })
  async reassignSubmission(
    @Req() req: RequestWithUser,
    @Param('itemId') itemId: string,
    @Param('itemType') itemType: string,
    @Body() body: { reviewerId: string; reason?: string; metadata?: Record<string, any> },
  ): Promise<AssignmentResponseDto> {
    const assignment =
      await this.reviewerAssignmentService.reassignSubmission(
        itemId,
        itemType,
        body.reviewerId,
        req.user.id,
        body.reason,
        body.metadata,
        req.user.email,
      );

    return this.mapToResponseDto(assignment);
  }

  /**
   * Unassign a submission from its reviewer
   */
  @Patch('unassign')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unassign submission from reviewer (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Submission successfully unassigned',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid state transition',
  })
  @ApiResponse({
    status: 404,
    description: 'Assignment not found',
  })
  async unassignSubmission(
    @Req() req: RequestWithUser,
    @Body() unassignDto: UnassignSubmissionDto,
  ): Promise<AssignmentResponseDto> {
    const assignment = await this.reviewerAssignmentService.unassignSubmission(
      unassignDto,
      req.user.id,
      req.user.email,
    );

    return this.mapToResponseDto(assignment);
  }

  /**
   * Update assignment state (e.g., mark as completed)
   */
  @Patch(':itemId/:itemType/state')
  @UseGuards(RolesGuard)
  @Roles(UserRole.REVIEWER, UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update assignment state (Reviewer or Admin)',
  })
  @ApiParam({ name: 'itemId', description: 'UUID of the item' })
  @ApiParam({ name: 'itemType', description: 'Type of the item' })
  @ApiResponse({
    status: 200,
    description: 'State successfully updated',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid state transition',
  })
  @ApiResponse({
    status: 404,
    description: 'Assignment not found',
  })
  async updateAssignmentState(
    @Req() req: RequestWithUser,
    @Param('itemId') itemId: string,
    @Param('itemType') itemType: string,
    @Body() updateDto: UpdateAssignmentStateDto,
  ): Promise<AssignmentResponseDto> {
    const assignment =
      await this.reviewerAssignmentService.updateAssignmentState(
        itemId,
        itemType,
        updateDto,
        req.user.id,
        req.user.email,
      );

    return this.mapToResponseDto(assignment);
  }

  /**
   * Get triage queue with filtering and pagination
   */
  @Get('queue')
  @ApiOperation({
    summary: 'Get triage queue (supports filtering by reviewer, state, item type)',
  })
  @ApiQuery({
    name: 'reviewerId',
    required: false,
    description: 'Filter by reviewer UUID',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['unassigned', 'in_review', 'completed'],
    description: 'Filter by assignment state',
  })
  @ApiQuery({
    name: 'itemType',
    required: false,
    description: 'Filter by item type',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['created_at', 'priority', 'updated_at'],
    description: 'Sort field (default: created_at)',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order (default: DESC)',
  })
  @ApiResponse({
    status: 200,
    description: 'List of assignments in triage queue',
  })
  async getTriageQueue(
    @Query() query: QueryTriageQueueDto,
  ): Promise<TriageQueueResponseDto> {
    const result = await this.reviewerAssignmentService.getTriageQueue(query);

    return {
      items: result.items.map((item) => this.mapToResponseDto(item)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Get assignment for a specific item
   */
  @Get(':itemId/:itemType')
  @ApiOperation({ summary: 'Get assignment details for a specific item' })
  @ApiParam({ name: 'itemId', description: 'UUID of the item' })
  @ApiParam({ name: 'itemType', description: 'Type of the item' })
  @ApiResponse({
    status: 200,
    description: 'Assignment details',
  })
  @ApiResponse({
    status: 404,
    description: 'Assignment not found',
  })
  async getAssignment(
    @Param('itemId') itemId: string,
    @Param('itemType') itemType: string,
  ): Promise<AssignmentResponseDto> {
    const assignment =
      await this.reviewerAssignmentService.getAssignmentByItem(
        itemId,
        itemType,
      );

    if (!assignment) {
      throw new NotFoundException(
        `Assignment not found for item ${itemId}`,
      );
    }

    return this.mapToResponseDto(assignment);
  }

  /**
   * Get audit logs for an assignment
   */
  @Get(':itemId/:itemType/audit-logs')
  @ApiOperation({ summary: 'Get audit logs for an assignment' })
  @ApiParam({ name: 'itemId', description: 'UUID of the item' })
  @ApiParam({ name: 'itemType', description: 'Type of the item' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Limit (default: 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Offset (default: 0)',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit logs for the assignment',
  })
  @ApiResponse({
    status: 404,
    description: 'Assignment not found',
  })
  async getAuditLogs(
    @Param('itemId') itemId: string,
    @Param('itemType') itemType: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    logs: AuditLogResponseDto[];
    total: number;
  }> {
    const assignment =
      await this.reviewerAssignmentService.getAssignmentByItem(
        itemId,
        itemType,
      );

    if (!assignment) {
      throw new NotFoundException(
        `Assignment not found for item ${itemId}`,
      );
    }

    const result = await this.reviewerAssignmentService.getAuditLogs(
      assignment.id,
      limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 50,
      offset ? Math.max(0, parseInt(offset, 10)) : 0,
    );

    return {
      logs: result.logs.map((log) => this.mapAuditLogToResponseDto(log)),
      total: result.total,
    };
  }

  /**
   * Get assignment statistics
   */
  @Get('stats/overview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get assignment statistics (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Assignment statistics',
  })
  async getStats(): Promise<{
    total: number;
    unassigned: number;
    inReview: number;
    completed: number;
    byReviewer: Array<{ reviewerId: string; count: number }>;
  }> {
    return this.reviewerAssignmentService.getAssignmentStats();
  }

  /**
   * Helper: Map ReviewerAssignment entity to response DTO
   */
  private mapToResponseDto(assignment: any): AssignmentResponseDto {
    return {
      id: assignment.id,
      itemId: assignment.itemId,
      itemType: assignment.itemType,
      state: assignment.state,
      reviewerId: assignment.reviewerId,
      reviewer: assignment.reviewer
        ? {
            id: assignment.reviewer.id,
            email: assignment.reviewer.email,
            displayName: assignment.reviewer.displayName,
          }
        : undefined,
      assignedById: assignment.assignedById,
      assignedBy: assignment.assignedBy
        ? {
            id: assignment.assignedBy.id,
            email: assignment.assignedBy.email,
            displayName: assignment.assignedBy.displayName,
          }
        : undefined,
      assignedAt: assignment.assignedAt,
      completedAt: assignment.completedAt,
      priority: assignment.priority,
      metadata: assignment.metadata,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  }

  /**
   * Helper: Map AssignmentAuditLog entity to response DTO
   */
  private mapAuditLogToResponseDto(log: any): AuditLogResponseDto {
    return {
      id: log.id,
      action: log.action,
      itemId: log.itemId,
      itemType: log.itemType,
      previousState: log.previousState,
      newState: log.newState,
      previousReviewerId: log.previousReviewerId,
      newReviewerId: log.newReviewerId,
      actorId: log.actorId,
      actorEmail: log.actorEmail,
      reason: log.reason,
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  }
}
