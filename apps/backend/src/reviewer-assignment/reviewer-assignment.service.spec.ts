import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewerAssignmentService } from './reviewer-assignment.service';
import { ReviewerAssignment, ReviewerAssignmentState } from './entities/reviewer-assignment.entity';
import { AssignmentAuditLog } from './entities/assignment-audit-log.entity';
import { User, UserRole } from '../users/entities/user.entity';

describe('ReviewerAssignmentService', () => {
  let service: ReviewerAssignmentService;
  let assignmentRepository: Repository<ReviewerAssignment>;
  let auditLogRepository: Repository<AssignmentAuditLog>;
  let userRepository: Repository<User>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockReviewerId = '00000000-0000-0000-0000-000000000002';
  const mockItemId = '00000000-0000-0000-0000-000000000003';
  const mockItemType = 'content_report';

  const mockUser = {
    id: mockUserId,
    email: 'admin@test.com',
    role: UserRole.ADMIN,
  };

  const mockReviewer = {
    id: mockReviewerId,
    email: 'reviewer@test.com',
    role: UserRole.REVIEWER,
  };

  const mockAssignment = {
    id: 'assignment-1',
    itemId: mockItemId,
    itemType: mockItemType,
    state: ReviewerAssignmentState.UNASSIGNED,
    reviewerId: null,
    assignedById: null,
    assignedAt: null,
    completedAt: null,
    priority: 0,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewerAssignmentService,
        {
          provide: getRepositoryToken(ReviewerAssignment),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            findAndCount: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(AssignmentAuditLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewerAssignmentService>(ReviewerAssignmentService);
    assignmentRepository = module.get<Repository<ReviewerAssignment>>(
      getRepositoryToken(ReviewerAssignment),
    );
    auditLogRepository = module.get<Repository<AssignmentAuditLog>>(
      getRepositoryToken(AssignmentAuditLog),
    );
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('assignSubmission', () => {
    it('should successfully assign a submission to a reviewer', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
        priority: 5,
      };

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockReviewer as any);

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(null);

      const createdAssignment = {
        ...mockAssignment,
        id: 'new-assignment',
      };

      jest
        .spyOn(assignmentRepository, 'create')
        .mockReturnValue(createdAssignment as any);

      jest
        .spyOn(assignmentRepository, 'save')
        .mockResolvedValue(createdAssignment as any);

      jest
        .spyOn(auditLogRepository, 'create')
        .mockReturnValue({ id: 'audit-1' } as any);

      jest
        .spyOn(auditLogRepository, 'save')
        .mockResolvedValue({ id: 'audit-1' } as any);

      // Mock query builder for locking
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(createdAssignment),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.assignSubmission(
        assignDto,
        mockUserId,
        'admin@test.com',
      );

      expect(result.state).toBe(ReviewerAssignmentState.IN_REVIEW);
      expect(result.reviewerId).toBe(mockReviewerId);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewerId },
        select: ['id', 'email', 'role'],
      });
    });

    it('should throw NotFoundException if reviewer does not exist', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: 'non-existent-reviewer',
      };

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.assignSubmission(assignDto, mockUserId, 'admin@test.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid state transition', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockReviewer as any);

      const completedAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.COMPLETED,
      };

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(completedAssignment as any);

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(completedAssignment),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await expect(
        service.assignSubmission(assignDto, mockUserId, 'admin@test.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reassignSubmission', () => {
    it('should successfully reassign submission to a different reviewer', async () => {
      const newReviewerId = '00000000-0000-0000-0000-000000000004';

      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockReviewer as any);

      const inReviewAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(inReviewAssignment as any);

      const reassignedAssignment = {
        ...inReviewAssignment,
        reviewerId: newReviewerId,
      };

      jest
        .spyOn(assignmentRepository, 'save')
        .mockResolvedValue(reassignedAssignment as any);

      jest
        .spyOn(auditLogRepository, 'create')
        .mockReturnValue({ id: 'audit-1' } as any);

      jest
        .spyOn(auditLogRepository, 'save')
        .mockResolvedValue({ id: 'audit-1' } as any);

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(inReviewAssignment),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.reassignSubmission(
        mockItemId,
        mockItemType,
        newReviewerId,
        mockUserId,
        'Need different reviewer',
        undefined,
        'admin@test.com',
      );

      expect(result.reviewerId).toBe(newReviewerId);
    });

    it('should throw NotFoundException if assignment does not exist', async () => {
      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockReviewer as any);

      jest.spyOn(assignmentRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.reassignSubmission(
          mockItemId,
          mockItemType,
          mockReviewerId,
          mockUserId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('unassignSubmission', () => {
    it('should successfully unassign a submission', async () => {
      const unassignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reason: 'Reassigning to another reviewer',
      };

      const inReviewAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(inReviewAssignment as any);

      const unassignedAssignment = {
        ...inReviewAssignment,
        state: ReviewerAssignmentState.UNASSIGNED,
        reviewerId: null,
      };

      jest
        .spyOn(assignmentRepository, 'save')
        .mockResolvedValue(unassignedAssignment as any);

      jest
        .spyOn(auditLogRepository, 'create')
        .mockReturnValue({ id: 'audit-1' } as any);

      jest
        .spyOn(auditLogRepository, 'save')
        .mockResolvedValue({ id: 'audit-1' } as any);

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(inReviewAssignment),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.unassignSubmission(
        unassignDto,
        mockUserId,
        'admin@test.com',
      );

      expect(result.state).toBe(ReviewerAssignmentState.UNASSIGNED);
      expect(result.reviewerId).toBeNull();
    });

    it('should throw NotFoundException if assignment does not exist', async () => {
      const unassignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
      };

      jest.spyOn(assignmentRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.unassignSubmission(unassignDto, mockUserId, 'admin@test.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAssignmentState', () => {
    it('should successfully update state from in_review to completed', async () => {
      const updateDto = {
        state: ReviewerAssignmentState.COMPLETED,
        reason: 'Review completed',
      };

      const inReviewAssignment = {
        ...mockAssignment,
        state: ReviewerAssignmentState.IN_REVIEW,
        reviewerId: mockReviewerId,
      };

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(inReviewAssignment as any);

      const completedAssignment = {
        ...inReviewAssignment,
        state: ReviewerAssignmentState.COMPLETED,
        completedAt: new Date(),
      };

      jest
        .spyOn(assignmentRepository, 'save')
        .mockResolvedValue(completedAssignment as any);

      jest
        .spyOn(auditLogRepository, 'create')
        .mockReturnValue({ id: 'audit-1' } as any);

      jest
        .spyOn(auditLogRepository, 'save')
        .mockResolvedValue({ id: 'audit-1' } as any);

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(inReviewAssignment),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.updateAssignmentState(
        mockItemId,
        mockItemType,
        updateDto,
        mockUserId,
        'admin@test.com',
      );

      expect(result.state).toBe(ReviewerAssignmentState.COMPLETED);
      expect(result.completedAt).toBeDefined();
    });

    it('should throw BadRequestException for invalid state transition', async () => {
      // Trying to transition from COMPLETED to IN_REVIEW - invalid path
      const updateDto = {
        state: ReviewerAssignmentState.IN_REVIEW,
      };

      const completedAssignment = {
        ...mockAssignment,
        id: 'assignment-completed-invalid',
        state: ReviewerAssignmentState.COMPLETED,
      };

      jest
        .spyOn(assignmentRepository, 'findOne')
        .mockResolvedValue(completedAssignment as any);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        useTransaction: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(completedAssignment as any),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await expect(
        service.updateAssignmentState(
          mockItemId,
          mockItemType,
          updateDto,
          mockUserId,
          'admin@test.com',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTriageQueue', () => {
    it('should return filtered triage queue by reviewer', async () => {
      const query = { reviewerId: mockReviewerId, limit: 20, page: 1 };

      const queueItems = [
        {
          ...mockAssignment,
          state: ReviewerAssignmentState.IN_REVIEW,
          reviewerId: mockReviewerId,
          reviewer: mockReviewer,
        },
      ];

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([queueItems, 1]),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getTriageQueue(query);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should return unassigned items when state is unassigned and no reviewer specified', async () => {
      const query = { state: 'unassigned', limit: 20, page: 1 };

      const queueItems = [
        {
          ...mockAssignment,
          state: ReviewerAssignmentState.UNASSIGNED,
          reviewerId: null,
        },
      ];

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([queueItems, 1]),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getTriageQueue(query);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].state).toBe(ReviewerAssignmentState.UNASSIGNED);
    });

    it('should apply sorting by priority', async () => {
      const query = { sortBy: 'priority', limit: 20, page: 1 };

      const queueItems = [
        { ...mockAssignment, priority: 10 },
        { ...mockAssignment, priority: 5 },
      ];

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([queueItems, 2]),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getTriageQueue(query);

      expect(result.items).toHaveLength(2);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('assignment.priority', 'DESC');
    });
  });

  describe('getAssignmentStats', () => {
    it('should return correct assignment statistics', async () => {
      jest.spyOn(assignmentRepository, 'count').mockResolvedValue(100);

      const countByState = {
        [ReviewerAssignmentState.UNASSIGNED]: 30,
        [ReviewerAssignmentState.IN_REVIEW]: 50,
        [ReviewerAssignmentState.COMPLETED]: 20,
      };

      jest
        .spyOn(assignmentRepository, 'count')
        .mockImplementation(async (options: any) => {
          if (!options) return 100;
          if (options.where?.state === ReviewerAssignmentState.UNASSIGNED) {
            return 30;
          }
          if (options.where?.state === ReviewerAssignmentState.IN_REVIEW) {
            return 50;
          }
          if (options.where?.state === ReviewerAssignmentState.COMPLETED) {
            return 20;
          }
          return 0;
        });

      const byReviewerData = [
        { reviewerId: mockReviewerId, count: '45' },
      ];

      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(byReviewerData),
      };

      jest
        .spyOn(assignmentRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getAssignmentStats();

      expect(result.total).toBe(100);
      expect(result.unassigned).toBe(30);
      expect(result.inReview).toBe(50);
      expect(result.completed).toBe(20);
      expect(result.byReviewer).toHaveLength(1);
    });
  });

  describe('getAuditLogs', () => {
    it('should return audit logs for an assignment', async () => {
      const assignmentId = 'assignment-1';
      const auditLogs = [
        {
          id: 'audit-1',
          action: 'assignment_created',
          assignmentId,
          itemId: mockItemId,
          itemType: mockItemType,
          newState: ReviewerAssignmentState.IN_REVIEW,
          newReviewerId: mockReviewerId,
          createdAt: new Date(),
        },
      ];

      jest
        .spyOn(auditLogRepository, 'findAndCount')
        .mockResolvedValue([auditLogs as any, 1]);

      const result = await service.getAuditLogs(assignmentId);

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.logs[0].action).toBe('assignment_created');
    });
  });
});
