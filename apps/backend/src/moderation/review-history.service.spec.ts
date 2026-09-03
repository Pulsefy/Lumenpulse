import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewHistoryService } from './review-history.service';
import {
  ReviewComment,
  CommentVisibility,
} from './entities/review-comment.entity';
import {
  ReviewDecisionHistory,
  DecisionType,
} from './entities/review-decision-history.entity';
import { UserRole } from '../users/entities/user.entity';

describe('ReviewHistoryService', () => {
  let service: ReviewHistoryService;
  let commentsRepository: Repository<ReviewComment>;
  let decisionsRepository: Repository<ReviewDecisionHistory>;

  const mockComment: Partial<ReviewComment> = {
    id: 'test-comment-id',
    targetId: 'project-123',
    targetType: 'project',
    visibility: CommentVisibility.PUBLIC,
    authorId: 'user-123',
    content: 'Test comment',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDecision: Partial<ReviewDecisionHistory> = {
    id: 'test-decision-id',
    targetId: 'project-123',
    targetType: 'project',
    decisionType: DecisionType.APPROVED,
    reviewerId: 'admin-123',
    rationale: 'Test rationale',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockCommentsRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getMany: jest.fn().mockResolvedValue([]),
      })),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const mockDecisionsRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewHistoryService,
        {
          provide: getRepositoryToken(ReviewComment),
          useValue: mockCommentsRepository,
        },
        {
          provide: getRepositoryToken(ReviewDecisionHistory),
          useValue: mockDecisionsRepository,
        },
      ],
    }).compile();

    service = module.get<ReviewHistoryService>(ReviewHistoryService);
    commentsRepository = module.get<Repository<ReviewComment>>(
      getRepositoryToken(ReviewComment),
    );
    decisionsRepository = module.get<Repository<ReviewDecisionHistory>>(
      getRepositoryToken(ReviewDecisionHistory),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createComment', () => {
    it('should create a public comment for regular user', async () => {
      (commentsRepository.create as jest.Mock).mockReturnValue(mockComment);
      (commentsRepository.save as jest.Mock).mockResolvedValue(mockComment);

      const result = await service.createComment('user-123', UserRole.USER, {
        targetId: 'project-123',
        targetType: 'project',
        content: 'Test comment',
      });

      expect(result).toBeDefined();
      expect(commentsRepository.save).toHaveBeenCalled();
    });

    it('should create an internal comment for admin', async () => {
      const internalComment = {
        ...mockComment,
        visibility: CommentVisibility.INTERNAL,
      };
      (commentsRepository.create as jest.Mock).mockReturnValue(internalComment);
      (commentsRepository.save as jest.Mock).mockResolvedValue(internalComment);

      const result = await service.createComment('admin-123', UserRole.ADMIN, {
        targetId: 'project-123',
        targetType: 'project',
        content: 'Internal note',
        visibility: CommentVisibility.INTERNAL,
      });

      expect(result).toBeDefined();
      expect(commentsRepository.save).toHaveBeenCalled();
    });

    it('should forbid non-admin from creating internal comments', async () => {
      await expect(
        service.createComment('user-123', UserRole.USER, {
          targetId: 'project-123',
          targetType: 'project',
          content: 'Internal note',
          visibility: CommentVisibility.INTERNAL,
        }),
      ).rejects.toThrow('Only admins can create internal comments');
    });
  });

  describe('createDecision', () => {
    it('should create a decision for admin', async () => {
      (decisionsRepository.create as jest.Mock).mockReturnValue(mockDecision);
      (decisionsRepository.save as jest.Mock).mockResolvedValue(mockDecision);

      const result = await service.createDecision('admin-123', UserRole.ADMIN, {
        targetId: 'project-123',
        targetType: 'project',
        decisionType: DecisionType.APPROVED,
        rationale: 'Test rationale',
      });

      expect(result).toBeDefined();
      expect(decisionsRepository.save).toHaveBeenCalled();
    });

    it('should forbid non-admin from creating decisions', async () => {
      await expect(
        service.createDecision('user-123', UserRole.USER, {
          targetId: 'project-123',
          targetType: 'project',
          decisionType: DecisionType.APPROVED,
        }),
      ).rejects.toThrow('Only admins can record review decisions');
    });
  });

  describe('getReviewHistory', () => {
    it('should return review history with visibility scoping for non-admin', async () => {
      const result = await service.getReviewHistory(
        { targetId: 'project-123', targetType: 'project' },
        UserRole.USER,
      );

      expect(result).toBeDefined();
      expect(result.comments).toEqual([]);
      expect(result.decisions).toEqual([]);
    });

    it('should return all comments including internal for admin', async () => {
      const result = await service.getReviewHistory(
        { targetId: 'project-123', targetType: 'project' },
        UserRole.ADMIN,
      );

      expect(result).toBeDefined();
      expect(result.comments).toEqual([]);
      expect(result.decisions).toEqual([]);
    });
  });

  describe('getCommentById', () => {
    it('should return public comment for any user', async () => {
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(mockComment);

      const result = await service.getCommentById(
        'test-comment-id',
        UserRole.USER,
      );

      expect(result).toBeDefined();
    });

    it('should forbid non-admin from accessing internal comment', async () => {
      const internalComment = {
        ...mockComment,
        visibility: CommentVisibility.INTERNAL,
      };
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(
        internalComment,
      );

      await expect(
        service.getCommentById('test-comment-id', UserRole.USER),
      ).rejects.toThrow('Access denied to internal comment');
    });

    it('should allow admin to access internal comment', async () => {
      const internalComment = {
        ...mockComment,
        visibility: CommentVisibility.INTERNAL,
      };
      (commentsRepository.findOne as jest.Mock).mockResolvedValue(
        internalComment,
      );

      const result = await service.getCommentById(
        'test-comment-id',
        UserRole.ADMIN,
      );

      expect(result).toBeDefined();
    });
  });
});
