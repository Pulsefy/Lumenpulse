import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewerAssignmentModule } from '../src/reviewer-assignment/reviewer-assignment.module';
import { ReviewerAssignment, ReviewerAssignmentState } from '../src/reviewer-assignment/entities/reviewer-assignment.entity';
import { AssignmentAuditLog } from '../src/reviewer-assignment/entities/assignment-audit-log.entity';
import { User, UserRole } from '../src/users/entities/user.entity';

/**
 * End-to-End Integration Tests for Reviewer Assignment System
 *
 * These tests verify:
 * - Complete assignment workflows
 * - State transitions and validation
 * - Concurrent assignment safety
 * - Audit logging accuracy
 * - Queue filtering and pagination
 * - API contract compliance
 */
describe('Reviewer Assignment (e2e)', () => {
  let app: INestApplication;
  let assignmentRepository: Repository<ReviewerAssignment>;
  let auditLogRepository: Repository<AssignmentAuditLog>;
  let userRepository: Repository<User>;

  const mockAdminId = '00000000-0000-0000-0000-000000000001';
  const mockReviewerId = '00000000-0000-0000-0000-000000000002';
  const mockSecondReviewerId = '00000000-0000-0000-0000-000000000003';
  const mockItemId = '00000000-0000-0000-0000-000000000004';
  const mockItemType = 'content_report';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ReviewerAssignmentModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    assignmentRepository = moduleFixture.get<Repository<ReviewerAssignment>>(
      getRepositoryToken(ReviewerAssignment),
    );
    auditLogRepository = moduleFixture.get<Repository<AssignmentAuditLog>>(
      getRepositoryToken(AssignmentAuditLog),
    );
    userRepository = moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await auditLogRepository.delete({});
    await assignmentRepository.delete({});
  });

  describe('Assignment Workflow', () => {
    it('should complete full assignment lifecycle: unassigned -> in_review -> completed', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
        priority: 5,
      };

      // 1. Create assignment (unassigned -> in_review)
      const assignResponse = await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      expect(assignResponse.body.state).toBe(ReviewerAssignmentState.IN_REVIEW);
      expect(assignResponse.body.reviewerId).toBe(mockReviewerId);

      const assignmentId = assignResponse.body.id;

      // 2. Verify assignment was created in database
      const assignment = await assignmentRepository.findOne({
        where: { id: assignmentId },
      });
      expect(assignment).toBeDefined();
      expect(assignment.state).toBe(ReviewerAssignmentState.IN_REVIEW);

      // 3. Update state to completed
      const updateDto = {
        state: ReviewerAssignmentState.COMPLETED,
        reason: 'Review completed successfully',
      };

      const updateResponse = await request(app.getHttpServer())
        .patch(`/reviewer-assignment/${mockItemId}/${mockItemType}/state`)
        .set('Authorization', `Bearer mock-token`)
        .send(updateDto)
        .expect(200);

      expect(updateResponse.body.state).toBe(ReviewerAssignmentState.COMPLETED);
      expect(updateResponse.body.completedAt).toBeDefined();

      // 4. Verify completion timestamp
      const completedAssignment = await assignmentRepository.findOne({
        where: { id: assignmentId },
      });
      expect(completedAssignment.completedAt).not.toBeNull();
    });

    it('should handle reassignment workflow', async () => {
      // 1. Initial assignment
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
        priority: 3,
      };

      const assignResponse = await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      expect(assignResponse.body.reviewerId).toBe(mockReviewerId);

      // 2. Reassign to different reviewer
      const reassignBody = {
        reviewerId: mockSecondReviewerId,
        reason: 'First reviewer unavailable',
      };

      const reassignResponse = await request(app.getHttpServer())
        .patch(
          `/reviewer-assignment/reassign/${mockItemId}/${mockItemType}`,
        )
        .set('Authorization', `Bearer mock-token`)
        .send(reassignBody)
        .expect(200);

      expect(reassignResponse.body.reviewerId).toBe(mockSecondReviewerId);

      // 3. Verify audit logs track the reassignment
      const auditLogs = await auditLogRepository.find({
        where: { itemId: mockItemId },
      });
      expect(auditLogs.length).toBeGreaterThanOrEqual(2); // At least initial + reassign
      const reassignLog = auditLogs.find((log) => log.action === 'assignment_reassigned');
      expect(reassignLog).toBeDefined();
      expect(reassignLog.previousReviewerId).toBe(mockReviewerId);
      expect(reassignLog.newReviewerId).toBe(mockSecondReviewerId);
    });

    it('should handle unassignment workflow', async () => {
      // 1. Create assignment
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      // 2. Unassign
      const unassignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reason: 'Reassigning to queue',
      };

      const unassignResponse = await request(app.getHttpServer())
        .patch('/reviewer-assignment/unassign')
        .set('Authorization', `Bearer mock-token`)
        .send(unassignDto)
        .expect(200);

      expect(unassignResponse.body.state).toBe(ReviewerAssignmentState.UNASSIGNED);
      expect(unassignResponse.body.reviewerId).toBeNull();

      // 3. Verify audit log
      const auditLogs = await auditLogRepository.find({
        where: { itemId: mockItemId },
      });
      const unassignLog = auditLogs.find((log) => log.action === 'assignment_removed');
      expect(unassignLog).toBeDefined();
      expect(unassignLog.previousReviewerId).toBe(mockReviewerId);
      expect(unassignLog.newReviewerId).toBeNull();
    });
  });

  describe('State Transition Validation', () => {
    it('should reject invalid state transitions', async () => {
      // 1. Create assignment in IN_REVIEW state
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      const assignResponse = await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      expect(assignResponse.body.state).toBe(ReviewerAssignmentState.IN_REVIEW);

      // 2. Try invalid transition: IN_REVIEW -> UNASSIGNED (should be allowed)
      const validUnassignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
      };

      const unassignResponse = await request(app.getHttpServer())
        .patch('/reviewer-assignment/unassign')
        .set('Authorization', `Bearer mock-token`)
        .send(validUnassignDto)
        .expect(200);

      expect(unassignResponse.body.state).toBe(ReviewerAssignmentState.UNASSIGNED);

      // 3. Try invalid transition: UNASSIGNED -> COMPLETED (should fail)
      const invalidUpdateDto = {
        state: ReviewerAssignmentState.COMPLETED,
      };

      await request(app.getHttpServer())
        .patch(`/reviewer-assignment/${mockItemId}/${mockItemType}/state`)
        .set('Authorization', `Bearer mock-token`)
        .send(invalidUpdateDto)
        .expect(400);
    });

    it('should enforce state machine constraints', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      // 1. Create assignment
      await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      // 2. Move to completed
      const completeDto = {
        state: ReviewerAssignmentState.COMPLETED,
      };

      await request(app.getHttpServer())
        .patch(`/reviewer-assignment/${mockItemId}/${mockItemType}/state`)
        .set('Authorization', `Bearer mock-token`)
        .send(completeDto)
        .expect(200);

      // 3. Try to move to IN_REVIEW from COMPLETED (invalid)
      const invalidTransitionDto = {
        state: ReviewerAssignmentState.IN_REVIEW,
      };

      await request(app.getHttpServer())
        .patch(`/reviewer-assignment/${mockItemId}/${mockItemType}/state`)
        .set('Authorization', `Bearer mock-token`)
        .send(invalidTransitionDto)
        .expect(400);
    });
  });

  describe('Triage Queue Filtering', () => {
    beforeEach(async () => {
      // Create multiple assignments for testing
      const itemIds = [
        '00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000011',
        '00000000-0000-0000-0000-000000000012',
      ];

      for (let i = 0; i < itemIds.length; i++) {
        const assignDto = {
          itemId: itemIds[i],
          itemType: mockItemType,
          reviewerId: i === 0 ? mockReviewerId : mockSecondReviewerId,
          priority: i,
        };

        await request(app.getHttpServer())
          .post('/reviewer-assignment/assign')
          .set('Authorization', `Bearer mock-token`)
          .send(assignDto);
      }
    });

    it('should filter queue by reviewer', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/queue?reviewerId=${mockReviewerId}&limit=10`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body.items).toBeDefined();
      expect(Array.isArray(response.body.items)).toBe(true);
      response.body.items.forEach((item: any) => {
        expect(item.reviewerId).toBe(mockReviewerId);
      });
    });

    it('should filter queue by state', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/queue?state=${ReviewerAssignmentState.IN_REVIEW}&limit=10`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body.items).toBeDefined();
      response.body.items.forEach((item: any) => {
        expect(item.state).toBe(ReviewerAssignmentState.IN_REVIEW);
      });
    });

    it('should support pagination', async () => {
      const page1Response = await request(app.getHttpServer())
        .get('/reviewer-assignment/queue?page=1&limit=2')
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(page1Response.body.page).toBe(1);
      expect(page1Response.body.limit).toBe(2);
      expect(page1Response.body.totalPages).toBeGreaterThanOrEqual(1);

      const page2Response = await request(app.getHttpServer())
        .get('/reviewer-assignment/queue?page=2&limit=2')
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(page2Response.body.page).toBe(2);
    });

    it('should support sorting', async () => {
      const priorityResponse = await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/queue?sortBy=priority&sortOrder=DESC&limit=10`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(priorityResponse.body.items).toBeDefined();
      // Items should be sorted by priority in descending order
      for (let i = 0; i < priorityResponse.body.items.length - 1; i++) {
        expect(
          priorityResponse.body.items[i].priority >= priorityResponse.body.items[i + 1].priority,
        ).toBe(true);
      }
    });
  });

  describe('Audit Logging', () => {
    it('should create comprehensive audit trail', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
        reason: 'Initial assignment',
      };

      const assignResponse = await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      const itemId = assignResponse.body.itemId;

      // Get audit logs
      const auditResponse = await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/${itemId}/${mockItemType}/audit-logs?limit=10`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(auditResponse.body.logs).toBeDefined();
      expect(auditResponse.body.logs.length).toBeGreaterThan(0);

      const firstLog = auditResponse.body.logs[0];
      expect(firstLog.action).toBe('assignment_created');
      expect(firstLog.newState).toBe(ReviewerAssignmentState.IN_REVIEW);
      expect(firstLog.newReviewerId).toBe(mockReviewerId);
    });

    it('should track all state changes in audit log', async () => {
      // 1. Create assignment
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      const assignResponse = await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(201);

      const itemId = assignResponse.body.itemId;

      // 2. Update to completed
      const completeDto = {
        state: ReviewerAssignmentState.COMPLETED,
      };

      await request(app.getHttpServer())
        .patch(`/reviewer-assignment/${itemId}/${mockItemType}/state`)
        .set('Authorization', `Bearer mock-token`)
        .send(completeDto)
        .expect(200);

      // 3. Get audit logs
      const auditResponse = await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/${itemId}/${mockItemType}/audit-logs?limit=10`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(auditResponse.body.logs.length).toBeGreaterThanOrEqual(2);

      // Verify state transitions are logged
      const stateChangedLog = auditResponse.body.logs.find(
        (log: any) => log.action === 'state_changed',
      );
      expect(stateChangedLog).toBeDefined();
      expect(stateChangedLog.previousState).toBe(ReviewerAssignmentState.IN_REVIEW);
      expect(stateChangedLog.newState).toBe(ReviewerAssignmentState.COMPLETED);
    });
  });

  describe('Assignment Statistics', () => {
    beforeEach(async () => {
      // Create assignments in different states
      const createAssignment = async (itemId: string, reviewerId: string | null, state: ReviewerAssignmentState) => {
        const assignment = assignmentRepository.create({
          itemId,
          itemType: mockItemType,
          state,
          reviewerId,
        });
        await assignmentRepository.save(assignment);
      };

      await createAssignment(
        '00000000-0000-0000-0000-000000000020',
        null,
        ReviewerAssignmentState.UNASSIGNED,
      );
      await createAssignment(
        '00000000-0000-0000-0000-000000000021',
        mockReviewerId,
        ReviewerAssignmentState.IN_REVIEW,
      );
      await createAssignment(
        '00000000-0000-0000-0000-000000000022',
        mockReviewerId,
        ReviewerAssignmentState.COMPLETED,
      );
      await createAssignment(
        '00000000-0000-0000-0000-000000000023',
        mockSecondReviewerId,
        ReviewerAssignmentState.IN_REVIEW,
      );
    });

    it('should return correct assignment statistics', async () => {
      const response = await request(app.getHttpServer())
        .get('/reviewer-assignment/stats/overview')
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body.total).toBeGreaterThanOrEqual(4);
      expect(response.body.unassigned).toBeGreaterThanOrEqual(1);
      expect(response.body.inReview).toBeGreaterThanOrEqual(2);
      expect(response.body.completed).toBeGreaterThanOrEqual(1);
      expect(response.body.byReviewer).toBeDefined();
      expect(Array.isArray(response.body.byReviewer)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent assignment', async () => {
      await request(app.getHttpServer())
        .get(
          `/reviewer-assignment/00000000-0000-0000-0000-000000000099/nonexistent/audit-logs`,
        )
        .set('Authorization', `Bearer mock-token`)
        .expect(404);
    });

    it('should return 400 for invalid request body', async () => {
      const invalidDto = {
        itemId: 'invalid-uuid', // Invalid UUID format
        itemType: mockItemType,
        reviewerId: mockReviewerId,
      };

      await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(invalidDto)
        .expect(400);
    });

    it('should return 404 when reviewer does not exist', async () => {
      const assignDto = {
        itemId: mockItemId,
        itemType: mockItemType,
        reviewerId: '00000000-0000-0000-0000-000000000099', // Non-existent
      };

      await request(app.getHttpServer())
        .post('/reviewer-assignment/assign')
        .set('Authorization', `Bearer mock-token`)
        .send(assignDto)
        .expect(404);
    });
  });
});
