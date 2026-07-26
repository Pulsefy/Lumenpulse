import { Test, TestingModule } from '@nestjs/testing';
import { ReviewerAssignmentController } from './reviewer-assignment.controller';
import { ReviewerAssignmentService } from './reviewer-assignment.service';
import { ReviewerAssignmentState } from './entities/reviewer-assignment.entity';
import { NotFoundException } from '@nestjs/common';

describe('ReviewerAssignmentController', () => {
  let controller: ReviewerAssignmentController;
  let service: ReviewerAssignmentService;

  const mockReviewerId = '00000000-0000-0000-0000-000000000002';
  const mockItemId = '00000000-0000-0000-0000-000000000003';
  const mockItemType = 'content_report';

  const mockAssignment = {
    id: 'assignment-1',
    itemId: mockItemId,
    itemType: mockItemType,
    state: ReviewerAssignmentState.UNASSIGNED,
    reviewerId: null,
    reviewer: null,
    assignedById: null,
    assignedBy: null,
    assignedAt: null,
    completedAt: null,
    priority: 0,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRequest = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@test.com',
      role: 'admin',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewerAssignmentController],
      providers: [
        {
          provide: ReviewerAssignmentService,
          useValue: {
            assignSubmission: jest.fn(),
            reassignSubmission: jest.fn(),
            unassignSubmission: jest.fn(),
            updateAssignmentState: jest.fn(),
            getTriageQueue: jest.fn(),
            getAssignmentByItem: jest.fn(),
            getAuditLogs: jest.fn(),
            getAssignmentStats: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReviewerAssignmentController>(
      ReviewerAssignmentController,
    );
    service = module.get<ReviewerAssignmentService>(ReviewerAssignmentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignSubmission', () => {
    it('should successfully assign a submission', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
        priority: 5,
      };

      const assignedAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(service, 'assignSubmission')
        .mockResolvedValue(assignedAssignment as any);

      const result = await controller.assignSubmission(
        mockRequest as any,
        assignDto,
      );

      expect(result.state).toBe(ReviewerAssignmentState.IN_REVIEW);
      expect(result.reviewerId).toBe(mockReviewerId);
      expect(service.assignSubmission).toHaveBeenCalledWith(
        assignDto,
        mockRequest.user.id,
        mockRequest.user.email,
      );
    });
  });

  describe('reassignSubmission', () => {
    it('should successfully reassign a submission', async () => {
      const newReviewerId = '00000000-0000-0000-0000-000000000004';
      const reassignBody = { reviewerId: newReviewerId, reason: 'Reassigning' };

      const reassignedAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: newReviewerId,
      };

      jest
        .spyOn(service, 'reassignSubmission')
        .mockResolvedValue(reassignedAssignment as any);

      const result = await controller.reassignSubmission(
        mockRequest as any,
        mockItemId,
        mockItemType,
        reassignBody,
      );

      expect(result.reviewerId).toBe(newReviewerId);
      expect(service.reassignSubmission).toHaveBeenCalledWith(
        mockItemId,
        mockItemType,
        newReviewerId,
        mockRequest.user.id,
        'Reassigning',
        undefined,
        mockRequest.user.email,
      );
    });
  });

  describe('unassignSubmission', () => {
    it('should successfully unassign a submission', async () => {
      const unassignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reason: 'Removing assignment',
      };

      const unassignedAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.UNASSIGNED,
        reviewerId: null,
      };

      jest
        .spyOn(service, 'unassignSubmission')
        .mockResolvedValue(unassignedAssignment as any);

      const result = await controller.unassignSubmission(
        mockRequest as any,
        unassignDto,
      );

      expect(result.state).toBe(ReviewerAssignmentState.UNASSIGNED);
      expect(result.reviewerId).toBeNull();
      expect(service.unassignSubmission).toHaveBeenCalledWith(
        unassignDto,
        mockRequest.user.id,
        mockRequest.user.email,
      );
    });
  });

  describe('updateAssignmentState', () => {
    it('should successfully update assignment state to completed', async () => {
      const updateDto = {
        state: ReviewerAssignmentState.COMPLETED,
        reason: 'Review completed',
      };

      const completedAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(service, 'updateAssignmentState')
        .mockResolvedValue(completedAssignment as any);

      const result = await controller.updateAssignmentState(
        mockRequest as any,
        mockItemId,
        mockItemType,
        updateDto,
      );

      expect(service.updateAssignmentState).toHaveBeenCalledWith(
        mockItemId,
        mockItemType,
        updateDto,
        mockRequest.user.id,
        mockRequest.user.email,
      );
    });
  });

  describe('getTriageQueue', () => {
    it('should return triage queue with filtering', async () => {
      const query = { reviewerId: mockReviewerId, state: 'in_review', limit: 20, page: 1 };

      const queueResult = {
        items: [
          {
            ...mockAssignment,
            state: ReviewerAssignmentState.IN_REVIEW,
            reviewerId: mockReviewerId,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      jest.spyOn(service, 'getTriageQueue').mockResolvedValue(queueResult as any);

      const result = await controller.getTriageQueue(query);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(service.getTriageQueue).toHaveBeenCalledWith(query);
    });

    it('should return empty queue when no items match filter', async () => {
      const query = { reviewerId: 'non-existent-reviewer', limit: 20, page: 1 };

      const emptyQueueResult = {
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };

      jest
        .spyOn(service, 'getTriageQueue')
        .mockResolvedValue(emptyQueueResult as any);

      const result = await controller.getTriageQueue(query);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getAssignment', () => {
    it('should return assignment details for a specific item', async () => {
      jest
        .spyOn(service, 'getAssignmentByItem')
        .mockResolvedValue(mockAssignment as any);

      const result = await controller.getAssignment(mockItemId, mockItemType);

      expect(result.itemId).toBe(mockItemId);
      expect(result.itemType).toBe(mockItemType);
      expect(service.getAssignmentByItem).toHaveBeenCalledWith(
        mockItemId,
        mockItemType,
      );
    });

    it('should throw NotFoundException if assignment does not exist', async () => {
      jest.spyOn(service, 'getAssignmentByItem').mockResolvedValue(null);

      await expect(
        controller.getAssignment(mockItemId, mockItemType),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAuditLogs', () => {
    it('should return audit logs for an assignment', async () => {
      const auditLogs = [
        {
          id: 'audit-1',
          action: 'assignment_created',
          itemId: mockItemId,
          itemType: mockItemType,
          newState: ReviewerAssignmentState.IN_REVIEW,
          newReviewerId: mockReviewerId,
          createdAt: new Date(),
        },
      ];

      jest
        .spyOn(service, 'getAssignmentByItem')
        .mockResolvedValue(mockAssignment as any);

      jest.spyOn(service, 'getAuditLogs').mockResolvedValue({
        logs: auditLogs,
        total: 1,
      });

      const result = await controller.getAuditLogs(
        mockItemId,
        mockItemType,
        '50',
        '0',
      );

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should throw NotFoundException if assignment does not exist', async () => {
      jest.spyOn(service, 'getAssignmentByItem').mockResolvedValue(null);

      await expect(
        controller.getAuditLogs(mockItemId, mockItemType),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('should return assignment statistics', async () => {
      const stats = {
        total: 100,
        unassigned: 30,
        inReview: 50,
        completed: 20,
        byReviewer: [{ reviewerId: mockReviewerId, count: 45 }],
      };

      jest.spyOn(service, 'getAssignmentStats').mockResolvedValue(stats as any);

      const result = await controller.getStats();

      expect(result.total).toBe(100);
      expect(result.unassigned).toBe(30);
      expect(result.inReview).toBe(50);
      expect(result.completed).toBe(20);
      expect(result.byReviewer).toHaveLength(1);
      expect(service.getAssignmentStats).toHaveBeenCalled();
    });
  });

  describe('mapToResponseDto', () => {
    it('should correctly map assignment entity to response DTO', async () => {
      const assignmentWithRelations = {
        ...mockAssignment,
        reviewer: { id: mockReviewerId, email: 'reviewer@test.com' },
        assignedBy: { id: '00000000-0000-0000-0000-000000000001', email: 'admin@test.com' },
      };

      jest
        .spyOn(service, 'getAssignmentByItem')
        .mockResolvedValue(assignmentWithRelations as any);

      const result = await controller.getAssignment(mockItemId, mockItemType);

      expect(result.reviewer).toBeDefined();
      expect(result.reviewer.id).toBe(mockReviewerId);
      expect(result.assignedBy).toBeDefined();
    });
  });
});
