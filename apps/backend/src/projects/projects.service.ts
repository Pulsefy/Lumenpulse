import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectSubmission, SubmissionStatus, ProjectType } from './entities/project-submission.entity';
import { ReviewFeedback, FeedbackType } from './entities/review-feedback.entity';
import { CreateProjectSubmissionDto } from './dto/create-project-submission.dto';
import { UpdateProjectSubmissionDto } from './dto/update-project-submission.dto';
import { SubmitForReviewDto } from './dto/submit-for-review.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class ProjectSubmissionsService {
  constructor(
    @InjectRepository(ProjectSubmission)
    private readonly submissionRepository: Repository<ProjectSubmission>,
    @InjectRepository(ReviewFeedback)
    private readonly feedbackRepository: Repository<ReviewFeedback>,
  ) {}

  /**
   * Create a new draft project submission
   */
  async createDraft(
    creatorId: string,
    createDto: CreateProjectSubmissionDto,
  ): Promise<ProjectSubmission> {
    const submission = this.submissionRepository.create({
      creatorId,
      title: createDto.title,
      description: createDto.description,
      detailedContent: createDto.detailedContent,
      projectType: createDto.projectType,
      repositoryUrl: createDto.repositoryUrl,
      liveUrl: createDto.liveUrl,
      metadata: createDto.metadata || {},
      status: SubmissionStatus.DRAFT,
    });

    return this.submissionRepository.save(submission);
  }

  /**
   * Update a draft submission (only allowed before submission for review)
   */
  async updateDraft(
    submissionId: string,
    creatorId: string,
    updateDto: UpdateProjectSubmissionDto,
  ): Promise<ProjectSubmission> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.creatorId !== creatorId) {
      throw new ForbiddenException('You can only edit your own submissions');
    }

    if (submission.status !== SubmissionStatus.DRAFT && submission.status !== SubmissionStatus.CHANGES_REQUESTED) {
      throw new BadRequestException(
        `Cannot edit submission with status: ${submission.status}. Only drafts and submissions with requested changes can be edited.`,
      );
    }

    Object.assign(submission, updateDto);
    submission.version += 1;

    return this.submissionRepository.save(submission);
  }

  /**
   * Submit a draft for review
   */
  async submitForReview(
    submissionId: string,
    creatorId: string,
    submitDto: SubmitForReviewDto,
  ): Promise<ProjectSubmission> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.creatorId !== creatorId) {
      throw new ForbiddenException('You can only submit your own submissions');
    }

    if (submission.status !== SubmissionStatus.DRAFT && submission.status !== SubmissionStatus.CHANGES_REQUESTED) {
      throw new BadRequestException(
        `Cannot submit submission with status: ${submission.status}`,
      );
    }

    submission.status = SubmissionStatus.UNDER_REVIEW;
    submission.submittedAt = new Date();
    submission.version += 1;

    if (submitDto.coverLetter) {
      submission.metadata = {
        ...submission.metadata,
        coverLetter: submitDto.coverLetter,
      };
    }

    return this.submissionRepository.save(submission);
  }

  /**
   * Get a submission by ID with related feedback
   */
  async getSubmissionById(submissionId: string): Promise<ProjectSubmission> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
      relations: ['creator', 'reviewedBy', 'reviewFeedback'],
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    return submission;
  }

  /**
   * List submissions with filtering and pagination
   */
  async listSubmissions(
    filters: {
      status?: SubmissionStatus;
      creatorId?: string;
      projectType?: ProjectType;
      page?: number;
      limit?: number;
    },
  ): Promise<{ submissions: ProjectSubmission[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    let query = this.submissionRepository.createQueryBuilder('submission')
      .leftJoinAndSelect('submission.creator', 'creator')
      .leftJoinAndSelect('submission.reviewedBy', 'reviewedBy')
      .leftJoinAndSelect('submission.reviewFeedback', 'feedback');

    if (filters.status) {
      query = query.andWhere('submission.status = :status', { status: filters.status });
    }

    if (filters.creatorId) {
      query = query.andWhere('submission.creatorId = :creatorId', {
        creatorId: filters.creatorId,
      });
    }

    if (filters.projectType) {
      query = query.andWhere('submission.projectType = :projectType', {
        projectType: filters.projectType,
      });
    }

    const [submissions, total] = await query
      .orderBy('submission.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return { submissions, total };
  }

  /**
   * List published projects (public view)
   */
  async listPublishedProjects(
    page: number = 1,
    limit: number = 10,
  ): Promise<{ projects: ProjectSubmission[]; total: number }> {
    const skip = (page - 1) * limit;

    const [projects, total] = await this.submissionRepository.find({
      where: { status: SubmissionStatus.PUBLISHED },
      relations: ['creator'],
      order: { publishedAt: 'DESC' },
      skip,
      take: limit,
    }).then(async (result) => {
      const count = await this.submissionRepository.count({
        where: { status: SubmissionStatus.PUBLISHED },
      });
      return [result, count];
    });

    return { projects, total };
  }

  /**
   * Request changes from creator (reviewer action)
   */
  async requestChanges(
    submissionId: string,
    reviewerId: string,
    reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmission> {
    const submission = await this.getSubmissionById(submissionId);

    if (submission.status !== SubmissionStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        `Cannot request changes for submission with status: ${submission.status}`,
      );
    }

    submission.status = SubmissionStatus.CHANGES_REQUESTED;
    submission.reviewedById = reviewerId;
    submission.version += 1;

    await this.submissionRepository.save(submission);

    // Add feedback
    const feedback = this.feedbackRepository.create({
      submissionId,
      reviewerId,
      type: FeedbackType.REQUEST_CHANGES,
      message: reviewDto.message,
      suggestions: reviewDto.suggestions,
    });

    await this.feedbackRepository.save(feedback);

    return this.getSubmissionById(submissionId);
  }

  /**
   * Approve a submission (reviewer action)
   */
  async approveSubmission(
    submissionId: string,
    reviewerId: string,
    reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmission> {
    const submission = await this.getSubmissionById(submissionId);

    if (submission.status !== SubmissionStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        `Cannot approve submission with status: ${submission.status}`,
      );
    }

    submission.status = SubmissionStatus.APPROVED;
    submission.reviewedById = reviewerId;
    submission.version += 1;

    await this.submissionRepository.save(submission);

    // Add approval feedback
    const feedback = this.feedbackRepository.create({
      submissionId,
      reviewerId,
      type: FeedbackType.APPROVAL,
      message: reviewDto.message,
      suggestions: reviewDto.suggestions,
    });

    await this.feedbackRepository.save(feedback);

    return this.getSubmissionById(submissionId);
  }

  /**
   * Reject a submission (reviewer action)
   */
  async rejectSubmission(
    submissionId: string,
    reviewerId: string,
    reviewDto: ReviewSubmissionDto,
  ): Promise<ProjectSubmission> {
    const submission = await this.getSubmissionById(submissionId);

    if (submission.status !== SubmissionStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        `Cannot reject submission with status: ${submission.status}`,
      );
    }

    submission.status = SubmissionStatus.REJECTED;
    submission.reviewedById = reviewerId;
    submission.rejectedAt = new Date();
    submission.version += 1;

    await this.submissionRepository.save(submission);

    // Add rejection feedback
    const feedback = this.feedbackRepository.create({
      submissionId,
      reviewerId,
      type: FeedbackType.REJECTION,
      message: reviewDto.message,
      suggestions: reviewDto.suggestions,
    });

    await this.feedbackRepository.save(feedback);

    return this.getSubmissionById(submissionId);
  }

  /**
   * Publish an approved submission
   */
  async publishSubmission(
    submissionId: string,
    publisherId: string,
  ): Promise<ProjectSubmission> {
    const submission = await this.getSubmissionById(submissionId);

    if (submission.status !== SubmissionStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot publish submission with status: ${submission.status}. Only approved submissions can be published.`,
      );
    }

    submission.status = SubmissionStatus.PUBLISHED;
    submission.publishedAt = new Date();
    submission.version += 1;

    return this.submissionRepository.save(submission);
  }

  /**
   * Delete a draft submission
   */
  async deleteDraft(
    submissionId: string,
    creatorId: string,
  ): Promise<void> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.creatorId !== creatorId) {
      throw new ForbiddenException('You can only delete your own submissions');
    }

    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException(
        'Only draft submissions can be deleted',
      );
    }

    await this.submissionRepository.softRemove(submission);
  }

  /**
   * Add a comment to a submission
   */
  async addComment(
    submissionId: string,
    reviewerId: string,
    message: string,
  ): Promise<ReviewFeedback> {
    const submission = await this.getSubmissionById(submissionId);

    const feedback = this.feedbackRepository.create({
      submissionId,
      reviewerId,
      type: FeedbackType.COMMENT,
      message,
    });

    return this.feedbackRepository.save(feedback);
  }

  /**
   * Resolve feedback
   */
  async resolveFeedback(feedbackId: string): Promise<ReviewFeedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: { id: feedbackId },
    });

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    feedback.isResolved = true;
    return this.feedbackRepository.save(feedback);
  }

  /**
   * Get user's submissions
   */
  async getUserSubmissions(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ submissions: ProjectSubmission[]; total: number }> {
    return this.listSubmissions({
      creatorId: userId,
      page,
      limit,
    });
  }

  /**
   * Get submissions for review (for reviewers)
   */
  async getSubmissionsForReview(
    page: number = 1,
    limit: number = 10,
  ): Promise<{ submissions: ProjectSubmission[]; total: number }> {
    return this.listSubmissions({
      status: SubmissionStatus.UNDER_REVIEW,
      page,
      limit,
    });
  }
}
