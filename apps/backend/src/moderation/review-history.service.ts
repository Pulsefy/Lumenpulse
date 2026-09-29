import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ReviewComment,
  CommentVisibility,
} from './entities/review-comment.entity';
import { ReviewDecisionHistory } from './entities/review-decision-history.entity';
import { CreateReviewCommentDto } from './dto/create-review-comment.dto';
import { CreateReviewDecisionDto } from './dto/create-review-decision.dto';
import { QueryReviewHistoryDto } from './dto/query-review-history.dto';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class ReviewHistoryService {
  private readonly logger = new Logger(ReviewHistoryService.name);

  constructor(
    @InjectRepository(ReviewComment)
    private commentsRepository: Repository<ReviewComment>,
    @InjectRepository(ReviewDecisionHistory)
    private decisionsRepository: Repository<ReviewDecisionHistory>,
  ) {}

  /**
   * Create a new review comment
   */
  async createComment(
    authorId: string,
    authorRole: UserRole,
    dto: CreateReviewCommentDto,
  ): Promise<ReviewComment> {
    // Only admins can create internal comments
    if (
      dto.visibility === CommentVisibility.INTERNAL &&
      authorRole !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('Only admins can create internal comments');
    }

    const comment = this.commentsRepository.create({
      ...dto,
      authorId,
      visibility: dto.visibility || CommentVisibility.PUBLIC,
    });

    const savedComment = await this.commentsRepository.save(comment);
    this.logger.log(
      `New review comment created: ${savedComment.id} for ${dto.targetType} ${dto.targetId}`,
    );

    return savedComment;
  }

  /**
   * Create a new review decision
   */
  async createDecision(
    reviewerId: string,
    reviewerRole: UserRole,
    dto: CreateReviewDecisionDto,
  ): Promise<ReviewDecisionHistory> {
    // Only admins can make review decisions
    if (reviewerRole !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can record review decisions');
    }

    const decision = this.decisionsRepository.create({
      ...dto,
      reviewerId,
    });

    const savedDecision = await this.decisionsRepository.save(decision);
    this.logger.log(
      `New review decision created: ${savedDecision.id} for ${dto.targetType} ${dto.targetId}`,
    );

    return savedDecision;
  }

  /**
   * Get review history (comments and decisions) for a target
   */
  async getReviewHistory(
    query: QueryReviewHistoryDto,
    userRole: UserRole,
  ): Promise<{
    comments: ReviewComment[];
    decisions: ReviewDecisionHistory[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));

    // Build comment query with visibility scoping
    const commentQueryBuilder = this.commentsRepository
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.author', 'author')
      .orderBy('comment.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Apply visibility scoping - non-admins only see public comments
    if (userRole !== UserRole.ADMIN) {
      commentQueryBuilder.andWhere('comment.visibility = :visibility', {
        visibility: CommentVisibility.PUBLIC,
      });
    } else if (query.visibility) {
      commentQueryBuilder.andWhere('comment.visibility = :visibility', {
        visibility: query.visibility,
      });
    }

    // Apply target filters
    if (query.targetId) {
      commentQueryBuilder.andWhere('comment.targetId = :targetId', {
        targetId: query.targetId,
      });
    }

    if (query.targetType) {
      commentQueryBuilder.andWhere('comment.targetType = :targetType', {
        targetType: query.targetType,
      });
    }

    // Build decision query
    const decisionQueryBuilder = this.decisionsRepository
      .createQueryBuilder('decision')
      .leftJoinAndSelect('decision.reviewer', 'reviewer')
      .orderBy('decision.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Apply target filters to decisions
    if (query.targetId) {
      decisionQueryBuilder.andWhere('decision.targetId = :targetId', {
        targetId: query.targetId,
      });
    }

    if (query.targetType) {
      decisionQueryBuilder.andWhere('decision.targetType = :targetType', {
        targetType: query.targetType,
      });
    }

    const [comments, commentCount] =
      await commentQueryBuilder.getManyAndCount();
    const [decisions, decisionCount] =
      await decisionQueryBuilder.getManyAndCount();

    return {
      comments,
      decisions,
      total: commentCount + decisionCount,
      page,
      limit,
      totalPages: Math.ceil(Math.max(commentCount, decisionCount) / limit),
    };
  }

  /**
   * Get comments by target ID
   */
  async getCommentsByTarget(
    targetId: string,
    targetType: string,
    userRole: UserRole,
  ): Promise<ReviewComment[]> {
    const queryBuilder = this.commentsRepository
      .createQueryBuilder('comment')
      .leftJoinAndSelect('comment.author', 'author')
      .where('comment.targetId = :targetId', { targetId })
      .andWhere('comment.targetType = :targetType', { targetType })
      .orderBy('comment.createdAt', 'ASC');

    // Apply visibility scoping
    if (userRole !== UserRole.ADMIN) {
      queryBuilder.andWhere('comment.visibility = :visibility', {
        visibility: CommentVisibility.PUBLIC,
      });
    }

    return queryBuilder.getMany();
  }

  /**
   * Get decisions by target ID
   */
  async getDecisionsByTarget(
    targetId: string,
    targetType: string,
  ): Promise<ReviewDecisionHistory[]> {
    return this.decisionsRepository
      .createQueryBuilder('decision')
      .leftJoinAndSelect('decision.reviewer', 'reviewer')
      .where('decision.targetId = :targetId', { targetId })
      .andWhere('decision.targetType = :targetType', { targetType })
      .orderBy('decision.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Get a single comment by ID
   */
  async getCommentById(id: string, userRole: UserRole): Promise<ReviewComment> {
    const comment = await this.commentsRepository.findOne({
      where: { id },
      relations: ['author'],
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Check visibility scoping
    if (
      comment.visibility === CommentVisibility.INTERNAL &&
      userRole !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('Access denied to internal comment');
    }

    return comment;
  }

  /**
   * Get a single decision by ID
   */
  async getDecisionById(id: string): Promise<ReviewDecisionHistory> {
    const decision = await this.decisionsRepository.findOne({
      where: { id },
      relations: ['reviewer'],
    });

    if (!decision) {
      throw new NotFoundException('Decision not found');
    }

    return decision;
  }
}
