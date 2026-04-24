import { Expose, Type } from 'class-transformer';
import { ReviewFeedback, FeedbackType } from '../entities/review-feedback.entity';
import { ProjectSubmission, SubmissionStatus, ProjectType } from '../entities/project-submission.entity';

export class ReviewFeedbackDto {
  @Expose()
  id: string;

  @Expose()
  submissionId: string;

  @Expose()
  reviewerId: string;

  @Expose()
  type: FeedbackType;

  @Expose()
  message: string;

  @Expose()
  suggestions?: Record<string, unknown>;

  @Expose()
  isResolved: boolean;

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  static fromEntity(feedback: ReviewFeedback): ReviewFeedbackDto {
    const dto = new ReviewFeedbackDto();
    dto.id = feedback.id;
    dto.submissionId = feedback.submissionId;
    dto.reviewerId = feedback.reviewerId;
    dto.type = feedback.type;
    dto.message = feedback.message;
    dto.suggestions = feedback.suggestions;
    dto.isResolved = feedback.isResolved;
    dto.createdAt = feedback.createdAt;
    dto.updatedAt = feedback.updatedAt;
    return dto;
  }
}

export class ProjectSubmissionResponseDto {
  @Expose()
  id: string;

  @Expose()
  creatorId: string;

  @Expose()
  title: string;

  @Expose()
  description: string;

  @Expose()
  detailedContent?: string;

  @Expose()
  projectType: ProjectType;

  @Expose()
  status: SubmissionStatus;

  @Expose()
  repositoryUrl?: string;

  @Expose()
  liveUrl?: string;

  @Expose()
  metadata?: Record<string, unknown>;

  @Expose()
  reviewedById?: string;

  @Expose()
  submittedAt?: Date;

  @Expose()
  publishedAt?: Date;

  @Expose()
  rejectedAt?: Date;

  @Expose()
  version: number;

  @Expose()
  @Type(() => ReviewFeedbackDto)
  reviewFeedback: ReviewFeedbackDto[];

  @Expose()
  @Type(() => Date)
  createdAt: Date;

  @Expose()
  @Type(() => Date)
  updatedAt: Date;

  static fromEntity(submission: ProjectSubmission): ProjectSubmissionResponseDto {
    const dto = new ProjectSubmissionResponseDto();
    dto.id = submission.id;
    dto.creatorId = submission.creatorId;
    dto.title = submission.title;
    dto.description = submission.description;
    dto.detailedContent = submission.detailedContent;
    dto.projectType = submission.projectType;
    dto.status = submission.status;
    dto.repositoryUrl = submission.repositoryUrl;
    dto.liveUrl = submission.liveUrl;
    dto.metadata = submission.metadata;
    dto.reviewedById = submission.reviewedById;
    dto.submittedAt = submission.submittedAt;
    dto.publishedAt = submission.publishedAt;
    dto.rejectedAt = submission.rejectedAt;
    dto.version = submission.version;
    dto.reviewFeedback = submission.reviewFeedback?.map((f) =>
      ReviewFeedbackDto.fromEntity(f),
    ) || [];
    dto.createdAt = submission.createdAt;
    dto.updatedAt = submission.updatedAt;
    return dto;
  }
}

export class ListProjectSubmissionsDto {
  @Expose()
  data: ProjectSubmissionResponseDto[];

  @Expose()
  total: number;

  @Expose()
  page: number;

  @Expose()
  limit: number;

  @Expose()
  totalPages: number;
}
