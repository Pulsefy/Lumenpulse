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
  BadRequestException,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { DecisionType } from './entities/review-decision-history.entity';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';

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
  constructor(
    private readonly reviewHistoryService: ReviewHistoryService,
    private readonly auditService: AuditService,
  ) {}

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

  @Post('decisions/bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record independent review decisions in bulk' })
  async createDecisionsBulk(
    @Req() req: RequestWithUser,
    @Body() body: { items: CreateReviewDecisionDto[] },
  ) {
    const items = body?.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      throw new BadRequestException('items must contain between 1 and 50 decisions');
    }
    if (items.some((item) => !item || typeof item.targetId !== 'string' || !item.targetId ||
      typeof item.targetType !== 'string' || !item.targetType ||
      !Object.values(DecisionType).includes(item.decisionType) ||
      (item.rationale !== undefined && (typeof item.rationale !== 'string' || item.rationale.length > 5000)))) {
      throw new BadRequestException('Each decision must include a target, supported decision type, and valid rationale');
    }
    const bulkOperationId = randomUUID();
    const results = await Promise.all(items.map(async (item, index) => {
      try {
        const value = await this.reviewHistoryService.createDecision(
          req.user.id, req.user.role as UserRole, item,
        );
        await this.auditService.log('create_review_decision', req.user.id, null, {
          decisionId: value.id,
          targetId: item.targetId,
          targetType: item.targetType,
          bulkOperationId,
        }).catch(() => undefined);
        return { index, success: true, value };
      } catch (error) {
        await this.auditService.log('create_review_decision_failed', req.user.id, null, {
          targetId: item.targetId,
          targetType: item.targetType,
          bulkOperationId,
          error: error instanceof Error ? error.message : 'Decision failed',
        }).catch(() => undefined);
        return { index, success: false, error: error instanceof Error ? error.message : 'Decision failed' };
      }
    }));
    return { bulkOperationId, results };
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
}
