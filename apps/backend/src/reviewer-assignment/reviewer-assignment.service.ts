import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryBuilder, Lock } from 'typeorm';
import { ReviewerAssignment, ReviewerAssignmentState } from './entities/reviewer-assignment.entity';
import { AssignmentAuditLog } from './entities/assignment-audit-log.entity';
import { AssignSubmissionDto } from './dto/assign-submission.dto';
import { UnassignSubmissionDto } from './dto/unassign-submission.dto';
import { UpdateAssignmentStateDto } from './dto/update-assignment-state.dto';
import { QueryTriageQueueDto } from './dto/query-triage-queue.dto';
import { User } from '../users/entities/user.entity';

export interface AuditLogParams {
  action: string;
  previousState?: ReviewerAssignmentState;
  newState?: ReviewerAssignmentState;
  previousReviewerId?: string;
  newReviewerId?: string;
  reason?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ReviewerAssignmentService {
  private readonly logger = new Logger(ReviewerAssignmentService.name);

  constructor(
    @InjectRepository(ReviewerAssignment)
    private readonly assignmentRepository: Repository<ReviewerAssignment>,
    @InjectRepository(AssignmentAuditLog)
    private readonly auditLogRepository: Repository<AssignmentAuditLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Get or create assignment for an item
   */
  private async getOrCreateAssignment(
    itemId: string,
    itemType: string,
  ): Promise<ReviewerAssignment> {
    let assignment = await this.assignmentRepository.findOne({
      where: { itemId, itemType },
    });

    if (!assignment) {
      assignment = this.assignmentRepository.create({
        itemId,
        itemType,
        state: ReviewerAssignmentState.UNASSIGNED,
      });
      assignment = await this.assignmentRepository.save(assignment);
      this.logger.log(
        `Created new assignment for item ${itemId} (type: ${itemType})`,
      );
    }

    return assignment;
  }

  /**
   * Assign submission to a reviewer with concurrency safety
   */
  async assignSubmission(
    dto: AssignSubmissionDto,
    actorId: string,
    actorEmail?: string,
  ): Promise<ReviewerAssignment> {
    // Verify reviewer exists
    const reviewer = await this.userRepository.findOne({
      where: { id: dto.reviewerId },
      select: ['id', 'email', 'role'],
    });

    if (!reviewer) {
      throw new NotFoundException(`Reviewer with ID ${dto.reviewerId} not found`);
    }

    // Get or create assignment
    let assignment = await this.getOrCreateAssignment(dto.itemId, dto.itemType);

    // Lock the assignment record for update to prevent race conditions
    const lockingQueryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .where('assignment.id = :id', { id: assignment.id })
      .setLock('pessimistic_write')
      .useTransaction(true);

    assignment = await lockingQueryBuilder.getOne();

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Check state transitions validity
    const validTransitions = this.getValidTransitions(assignment.state);
    if (!validTransitions.includes(ReviewerAssignmentState.IN_REVIEW)) {
      throw new BadRequestException(
        `Cannot transition from ${assignment.state} to in_review state`,
      );
    }

    // Store previous values for audit
    const previousState = assignment.state;
    const previousReviewerId = assignment.reviewerId;

    // Update assignment
    assignment.state = ReviewerAssignmentState.IN_REVIEW;
    assignment.reviewerId = dto.reviewerId;
    assignment.assignedById = actorId;
    assignment.assignedAt = new Date();
    assignment.priority = dto.priority ?? assignment.priority;
    if (dto.metadata) {
      assignment.metadata = {
        ...assignment.metadata,
        ...dto.metadata,
      };
    }

    assignment = await this.assignmentRepository.save(assignment);

    // Log the audit
    await this.logAssignmentChange(
      assignment,
      {
        action: 'assignment_created',
        previousState,
        newState: assignment.state,
        previousReviewerId,
        newReviewerId: dto.reviewerId,
        reason: dto.reason,
        metadata: dto.metadata,
      },
      actorId,
      actorEmail,
    );

    this.logger.log(
      `Assigned item ${dto.itemId} to reviewer ${dto.reviewerId}`,
    );

    return assignment;
  }

  /**
   * Reassign submission to a different reviewer
   */
  async reassignSubmission(
    itemId: string,
    itemType: string,
    newReviewerId: string,
    actorId: string,
    reason?: string,
    metadata?: Record<string, any>,
    actorEmail?: string,
  ): Promise<ReviewerAssignment> {
    // Verify reviewer exists
    const reviewer = await this.userRepository.findOne({
      where: { id: newReviewerId },
      select: ['id', 'email'],
    });

    if (!reviewer) {
      throw new NotFoundException(
        `Reviewer with ID ${newReviewerId} not found`,
      );
    }

    let assignment = await this.assignmentRepository.findOne({
      where: { itemId, itemType },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment not found for item ${itemId}`,
      );
    }

    // Lock for concurrency safety
    const lockingQueryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .where('assignment.id = :id', { id: assignment.id })
      .setLock('pessimistic_write')
      .useTransaction(true);

    assignment = await lockingQueryBuilder.getOne();

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Store previous values
    const previousState = assignment.state;
    const previousReviewerId = assignment.reviewerId;

    // Update assignment
    assignment.reviewerId = newReviewerId;
    assignment.assignedById = actorId;
    assignment.assignedAt = new Date();
    if (metadata) {
      assignment.metadata = {
        ...assignment.metadata,
        ...metadata,
      };
    }

    assignment = await this.assignmentRepository.save(assignment);

    // Log the audit
    await this.logAssignmentChange(
      assignment,
      {
        action: 'assignment_reassigned',
        previousState,
        newState: assignment.state,
        previousReviewerId,
        newReviewerId,
        reason,
        metadata,
      },
      actorId,
      actorEmail,
    );

    this.logger.log(
      `Reassigned item ${itemId} from ${previousReviewerId} to ${newReviewerId}`,
    );

    return assignment;
  }

  /**
   * Unassign submission from reviewer
   */
  async unassignSubmission(
    dto: UnassignSubmissionDto,
    actorId: string,
    actorEmail?: string,
  ): Promise<ReviewerAssignment> {
    let assignment = await this.assignmentRepository.findOne({
      where: { itemId: dto.itemId, itemType: dto.itemType },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment not found for item ${dto.itemId}`,
      );
    }

    // Lock for concurrency safety
    const lockingQueryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .where('assignment.id = :id', { id: assignment.id })
      .setLock('pessimistic_write')
      .useTransaction(true);

    assignment = await lockingQueryBuilder.getOne();

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    // Store previous values
    const previousState = assignment.state;
    const previousReviewerId = assignment.reviewerId;

    // Validate state transition
    const validTransitions = this.getValidTransitions(assignment.state);
    if (!validTransitions.includes(ReviewerAssignmentState.UNASSIGNED)) {
      throw new BadRequestException(
        `Cannot transition from ${assignment.state} to unassigned state`,
      );
    }

    // Update assignment
    assignment.state = ReviewerAssignmentState.UNASSIGNED;
    assignment.reviewerId = null;
    assignment.assignedAt = null;
    if (dto.metadata) {
      assignment.metadata = {
        ...assignment.metadata,
        ...dto.metadata,
      };
    }

    assignment = await this.assignmentRepository.save(assignment);

    // Log the audit
    await this.logAssignmentChange(
      assignment,
      {
        action: 'assignment_removed',
        previousState,
        newState: assignment.state,
        previousReviewerId,
        reason: dto.reason,
        metadata: dto.metadata,
      },
      actorId,
      actorEmail,
    );

    this.logger.log(`Unassigned item ${dto.itemId}`);

    return assignment;
  }

  /**
   * Update assignment state (e.g., mark as completed)
   */
  async updateAssignmentState(
    itemId: string,
    itemType: string,
    dto: UpdateAssignmentStateDto,
    actorId: string,
    actorEmail?: string,
  ): Promise<ReviewerAssignment> {
    let assignment = await this.assignmentRepository.findOne({
      where: { itemId, itemType },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment not found for item ${itemId}`,
      );
    }

    // Lock for concurrency safety
    const lockingQueryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .where('assignment.id = :id', { id: assignment.id })
      .setLock('pessimistic_write')
      .useTransaction(true);

    assignment = await lockingQueryBuilder.getOne();

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    const newState = dto.state as ReviewerAssignmentState;

    // Validate state transition
    const validTransitions = this.getValidTransitions(assignment.state);
    if (!validTransitions.includes(newState)) {
      throw new BadRequestException(
        `Cannot transition from ${assignment.state} to ${newState} state`,
      );
    }

    // Store previous values
    const previousState = assignment.state;

    // Update assignment
    assignment.state = newState;
    if (newState === ReviewerAssignmentState.COMPLETED) {
      assignment.completedAt = new Date();
    }
    if (dto.metadata) {
      assignment.metadata = {
        ...assignment.metadata,
        ...dto.metadata,
      };
    }

    assignment = await this.assignmentRepository.save(assignment);

    // Log the audit
    await this.logAssignmentChange(
      assignment,
      {
        action: 'state_changed',
        previousState,
        newState: assignment.state,
        reason: dto.reason,
        metadata: dto.metadata,
      },
      actorId,
      actorEmail,
    );

    this.logger.log(`Updated assignment state for item ${itemId} to ${newState}`);

    return assignment;
  }

  /**
   * Get triage queue with filtering and pagination
   */
  async getTriageQueue(
    query: QueryTriageQueueDto,
  ): Promise<{
    items: ReviewerAssignment[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const queryBuilder = this.assignmentRepository
      .createQueryBuilder('assignment')
      .leftJoinAndSelect('assignment.reviewer', 'reviewer')
      .leftJoinAndSelect('assignment.assignedBy', 'assignedBy');

    // Apply filters
    if (query.reviewerId) {
      queryBuilder.andWhere('assignment.reviewerId = :reviewerId', {
        reviewerId: query.reviewerId,
      });
    } else if (query.state === 'unassigned') {
      // If no reviewer specified and looking for unassigned, ensure reviewerId is NULL
      queryBuilder.andWhere('assignment.reviewerId IS NULL');
    }

    if (query.state) {
      queryBuilder.andWhere('assignment.state = :state', {
        state: query.state,
      });
    }

    if (query.itemType) {
      queryBuilder.andWhere('assignment.itemType = :itemType', {
        itemType: query.itemType,
      });
    }

    // Apply sorting
    const sortBy = query.sortBy ?? 'created_at';
    const sortOrder = (query.sortOrder ?? 'DESC') as 'ASC' | 'DESC';

    if (sortBy === 'priority') {
      queryBuilder
        .orderBy('assignment.priority', 'DESC')
        .addOrderBy('assignment.createdAt', 'DESC');
    } else if (sortBy === 'updated_at') {
      queryBuilder.orderBy('assignment.updatedAt', sortOrder);
    } else {
      queryBuilder.orderBy('assignment.createdAt', sortOrder);
    }

    // Apply pagination
    queryBuilder.skip((page - 1) * limit).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get assignment by item
   */
  async getAssignmentByItem(
    itemId: string,
    itemType: string,
  ): Promise<ReviewerAssignment | null> {
    return this.assignmentRepository.findOne({
      where: { itemId, itemType },
      relations: ['reviewer', 'assignedBy'],
    });
  }

  /**
   * Get assignment audit logs
   */
  async getAuditLogs(
    assignmentId: string,
    limit = 50,
    offset = 0,
  ): Promise<{
    logs: AssignmentAuditLog[];
    total: number;
  }> {
    const [logs, total] = await this.auditLogRepository.findAndCount({
      where: { assignmentId },
      relations: ['actor', 'newReviewer', 'previousReviewer'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { logs, total };
  }

  /**
   * Get valid state transitions
   */
  private getValidTransitions(currentState: ReviewerAssignmentState): ReviewerAssignmentState[] {
    const transitions: Record<ReviewerAssignmentState, ReviewerAssignmentState[]> = {
      [ReviewerAssignmentState.UNASSIGNED]: [
        ReviewerAssignmentState.IN_REVIEW,
      ],
      [ReviewerAssignmentState.IN_REVIEW]: [
        ReviewerAssignmentState.COMPLETED,
        ReviewerAssignmentState.UNASSIGNED,
      ],
      [ReviewerAssignmentState.COMPLETED]: [
        ReviewerAssignmentState.UNASSIGNED,
      ],
    };

    return transitions[currentState] || [];
  }

  /**
   * Log assignment change to audit log
   */
  private async logAssignmentChange(
    assignment: ReviewerAssignment,
    params: AuditLogParams,
    actorId: string,
    actorEmail?: string,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        assignmentId: assignment.id,
        itemId: assignment.itemId,
        itemType: assignment.itemType,
        action: params.action,
        previousState: params.previousState,
        newState: params.newState,
        previousReviewerId: params.previousReviewerId,
        newReviewerId: params.newReviewerId,
        actorId,
        actorEmail,
        reason: params.reason,
        metadata: params.metadata,
      });

      await this.auditLogRepository.save(auditLog);
      this.logger.debug(
        `Audit log created for assignment ${assignment.id}: ${params.action}`,
      );
    } catch (error) {
      // Audit failures should not disrupt the main operation
      this.logger.error(
        `Failed to log assignment change for ${assignment.id}`,
        error,
      );
    }
  }

  /**
   * Get assignment statistics
   */
  async getAssignmentStats(): Promise<{
    total: number;
    unassigned: number;
    inReview: number;
    completed: number;
    byReviewer: Array<{ reviewerId: string; count: number }>;
  }> {
    const totalResult = await this.assignmentRepository.count();

    const unassignedResult = await this.assignmentRepository.count({
      where: { state: ReviewerAssignmentState.UNASSIGNED },
    });

    const inReviewResult = await this.assignmentRepository.count({
      where: { state: ReviewerAssignmentState.IN_REVIEW },
    });

    const completedResult = await this.assignmentRepository.count({
      where: { state: ReviewerAssignmentState.COMPLETED },
    });

    const byReviewerQuery = await this.assignmentRepository
      .createQueryBuilder('assignment')
      .select('assignment.reviewerId', 'reviewerId')
      .addSelect('COUNT(*)', 'count')
      .where('assignment.reviewerId IS NOT NULL')
      .groupBy('assignment.reviewerId')
      .orderBy('count', 'DESC')
      .getRawMany();

    const byReviewer = byReviewerQuery.map((row) => ({
      reviewerId: row.reviewerId,
      count: parseInt(row.count, 10),
    }));

    return {
      total: totalResult,
      unassigned: unassignedResult,
      inReview: inReviewResult,
      completed: completedResult,
      byReviewer,
    };
  }
}
