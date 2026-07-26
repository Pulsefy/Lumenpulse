export class ReviewerDto {
  id: string;
  email: string;
  displayName?: string;
}

export class AssignmentResponseDto {
  id: string;
  itemId: string;
  itemType: string;
  state: string;
  reviewer?: ReviewerDto;
  reviewerId?: string;
  assignedBy?: ReviewerDto;
  assignedById?: string;
  assignedAt?: Date;
  completedAt?: Date;
  priority: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class TriageQueueResponseDto {
  items: AssignmentResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class AuditLogResponseDto {
  id: string;
  action: string;
  itemId: string;
  itemType: string;
  previousState?: string;
  newState?: string;
  previousReviewerId?: string;
  newReviewerId?: string;
  actorId: string;
  actorEmail?: string;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}
