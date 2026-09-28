import {
  Controller,
  Get,
  Post,
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
import { ReviewHistoryService } from './review-history.service';
import { CreateReviewCommentDto } from './dto/create-review-comment.dto';
import { CreateReviewDecisionDto } from './dto/create-review-decision.dto';
import { QueryReviewHistoryDto } from './dto/query-review-history.dto';
import { BulkReviewTriageDto } from './dto/bulk-review-triage.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('review-history')
@ApiBearerAuth('JWT-auth')
@Controller('review-history')
@UseGuards(JwtAuthGuard)
export class ReviewHistoryController {
  constructor(private readonly reviewHistoryService: ReviewHistoryService) {}

  @Post('comments')
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a review comment' })
  @ApiResponse({ status: 201, description: 'Comment successfully created' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - insufficient permissions',
  })
  async createComment(
    @Req() req: RequestWithUser,
    @Body() createCommentDto: CreateReviewCommentDto,
  ) {
    return this.reviewHistoryService.createComment(
      req.user.id,
      req.user.role as UserRole,
      createCommentDto,
    );
  }

  @Post('decisions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a review decision (Admin only)' })
  @ApiResponse({ status: 201, description: 'Decision successfully recorded' })
  @ApiResponse({ status: 403, description: 'Forbidden - admin only' })
  async createDecision(
    @Req() req: RequestWithUser,
    @Body() createDecisionDto: CreateReviewDecisionDto,
  ) {
    return this.reviewHistoryService.createDecision(
      req.user.id,
      req.user.role as UserRole,
      createDecisionDto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get review history (comments and decisions)' })
  @ApiResponse({
    status: 200,
    description: 'Review history retrieved successfully',
  })
  async getReviewHistory(
    @Req() req: RequestWithUser,
    @Query() query: QueryReviewHistoryDto,
  ) {
    return this.reviewHistoryService.getReviewHistory(
      query,
      req.user.role as UserRole,
    );
  }

  @Get('target/:targetType/:targetId')
  @ApiOperation({ summary: 'Get review history for a specific target' })
  @ApiResponse({
    status: 200,
    description: 'Target review history retrieved successfully',
  })
  async getTargetReviewHistory(
    @Req() req: RequestWithUser,
    @Param('targetType') targetType: string,
    @Param('targetId') targetId: string,
  ) {
    const [comments, decisions] = await Promise.all([
      this.reviewHistoryService.getCommentsByTarget(
        targetId,
        targetType,
        req.user.role as UserRole,
      ),
      this.reviewHistoryService.getDecisionsByTarget(targetId, targetType),
    ]);

    return {
      comments,
      decisions,
    };
  }

  @Get('comments/:id')
  @ApiOperation({ summary: 'Get a specific comment by ID' })
  @ApiResponse({ status: 200, description: 'Comment retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  @ApiResponse({
    status: 403,
    description: 'Access denied to internal comment',
  })
  async getComment(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.reviewHistoryService.getCommentById(
      id,
      req.user.role as UserRole,
    );
  }

  @Get('decisions/:id')
  @ApiOperation({ summary: 'Get a specific decision by ID' })
  @ApiResponse({ status: 200, description: 'Decision retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Decision not found' })
  async getDecision(@Param('id') id: string) {
    return this.reviewHistoryService.getDecisionById(id);
  }

  // ─── BULK ENDPOINTS ───────────────────────────────────────────────────

  /**
   * POST /review-history/bulk-triage
   *
   * Record review decisions for multiple targets in a single request.
   * Per-item atomicity: each decision is saved independently.
   */
  @Post('bulk-triage')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @HttpCode(HttpStatus.MULTI_STATUS)
  @ApiOperation({
    summary: 'Bulk record review triage decisions (Admin only)',
    description:
      'Record up to 100 review decisions in a single request. ' +
      'Items are processed independently — one failure does not abort others. ' +
      'A shared bulkOperationId appears in every audit entry.',
  })
  @ApiResponse({
    status: 207,
    description: 'Multi-status: per-item results for every decision',
  })
  @ApiResponse({ status: 400, description: 'Validation error or batch too large' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async bulkTriage(
    @Req() req: RequestWithUser,
    @Body() dto: BulkReviewTriageDto,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;

    return this.reviewHistoryService.bulkTriage(req.user.id, ip, dto);
  }
}
