# Reviewer Assignment System & Triage Queue API - Implementation Guide

## Overview

This document describes the complete implementation of the Reviewer Assignment System & Triage Queue API for the Lumenpulse backend. The system manages assignment of moderation items to reviewers, tracks assignment state, handles concurrent operations safely, and provides a comprehensive audit trail.

## Architecture

### Database Schema

The system uses two main tables:

#### 1. `reviewer_assignments`
Stores the current assignment state for moderation items.

```sql
CREATE TABLE "reviewer_assignments" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "item_id" uuid NOT NULL,
  "item_type" VARCHAR NOT NULL,
  "state" reviewer_assignment_state_enum NOT NULL DEFAULT 'unassigned',
  "reviewer_id" uuid,
  "assigned_by_id" uuid,
  "assigned_at" TIMESTAMP,
  "completed_at" TIMESTAMP,
  "priority" INTEGER DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP DEFAULT now(),
  "updated_at" TIMESTAMP DEFAULT now(),
  UNIQUE(item_id, item_type)
);
```

**State Enum:** `unassigned`, `in_review`, `completed`

**Key Indexes:**
- `state` - for filtering by state
- `reviewer_id` - for fetching reviewer's queue
- `(item_id, item_type)` - for finding specific assignments (unique)
- `(created_at, priority)` - for sorting queue items

#### 2. `assignment_audit_logs`
Immutable audit trail of all assignment changes.

```sql
CREATE TABLE "assignment_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "assignment_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "item_type" VARCHAR NOT NULL,
  "action" VARCHAR NOT NULL,
  "previous_state" reviewer_assignment_state_enum,
  "new_state" reviewer_assignment_state_enum,
  "previous_reviewer_id" uuid,
  "new_reviewer_id" uuid,
  "actor_id" uuid NOT NULL,
  "actor_email" VARCHAR,
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP DEFAULT now()
);
```

**Actions Tracked:**
- `assignment_created` - New assignment to reviewer
- `assignment_reassigned` - Reassignment to different reviewer
- `assignment_removed` - Removed from reviewer
- `state_changed` - State transition (e.g., completed)

### TypeORM Entities

#### ReviewerAssignment
Located in `entities/reviewer-assignment.entity.ts`

```typescript
@Entity('reviewer_assignments')
export class ReviewerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column({ type: 'enum', enum: ReviewerAssignmentState })
  state: ReviewerAssignmentState;

  @Column({ name: 'reviewer_id', type: 'uuid', nullable: true })
  reviewerId?: string;

  @ManyToOne(() => User)
  reviewer?: User;

  @Column({ name: 'assigned_by_id', type: 'uuid', nullable: true })
  assignedById?: string;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

#### AssignmentAuditLog
Located in `entities/assignment-audit-log.entity.ts`

```typescript
@Entity('assignment_audit_logs')
export class AssignmentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @ManyToOne(() => ReviewerAssignment, { onDelete: 'CASCADE' })
  assignment: ReviewerAssignment;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'item_type' })
  itemType: string;

  @Column()
  action: string;

  @Column({ type: 'enum', enum: ReviewerAssignmentState, nullable: true })
  previousState?: ReviewerAssignmentState;

  @Column({ type: 'enum', enum: ReviewerAssignmentState, nullable: true })
  newState?: ReviewerAssignmentState;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
```

## State Machine

### Valid State Transitions

```
UNASSIGNED -> IN_REVIEW
IN_REVIEW -> COMPLETED
IN_REVIEW -> UNASSIGNED
COMPLETED -> UNASSIGNED
```

**Enforcement:**
- All assignments start in `UNASSIGNED` state
- Transitions are validated before state updates
- Invalid transitions throw `BadRequestException`
- See `getValidTransitions()` method in service for complete logic

## API Endpoints

### 1. Assign Submission
**POST** `/reviewer-assignment/assign`
- **Role Required:** ADMIN
- **Description:** Assign a submission to a reviewer

**Request Body:**
```typescript
{
  itemId: string;           // UUID of item
  itemType: string;         // Type of item (e.g., 'content_report')
  reviewerId: string;       // UUID of reviewer
  priority?: number;        // 0-100, optional
  reason?: string;          // Optional reason for assignment
  metadata?: Record<string, any>;
}
```

**Response:** `ReviewerAssignment` entity

**Errors:**
- `404` - Reviewer not found
- `400` - Invalid state transition
- `409` - Item already assigned (duplicate key)

### 2. Reassign Submission
**PATCH** `/reviewer-assignment/reassign/:itemId/:itemType`
- **Role Required:** ADMIN
- **Description:** Reassign item to a different reviewer

**Request Body:**
```typescript
{
  reviewerId: string;       // UUID of new reviewer
  reason?: string;          // Reason for reassignment
  metadata?: Record<string, any>;
}
```

**Response:** `ReviewerAssignment` entity

**Errors:**
- `404` - Assignment or reviewer not found
- `400` - Invalid state transition

### 3. Unassign Submission
**PATCH** `/reviewer-assignment/unassign`
- **Role Required:** ADMIN
- **Description:** Remove assignment from reviewer

**Request Body:**
```typescript
{
  itemId: string;
  itemType: string;
  reason?: string;          // Reason for unassignment
  metadata?: Record<string, any>;
}
```

**Response:** `ReviewerAssignment` entity

**Errors:**
- `404` - Assignment not found
- `400` - Cannot unassign from COMPLETED state

### 4. Update Assignment State
**PATCH** `/reviewer-assignment/:itemId/:itemType/state`
- **Role Required:** REVIEWER or ADMIN
- **Description:** Update assignment state (e.g., mark as completed)

**Request Body:**
```typescript
{
  state: 'unassigned' | 'in_review' | 'completed';
  reason?: string;
  metadata?: Record<string, any>;
}
```

**Response:** `ReviewerAssignment` entity

**Errors:**
- `404` - Assignment not found
- `400` - Invalid state transition

### 5. Get Triage Queue
**GET** `/reviewer-assignment/queue`
- **Role Required:** None (public access with auth)
- **Description:** Get queue of assignments with filtering, sorting, and pagination

**Query Parameters:**
```typescript
{
  reviewerId?: string;      // Filter by reviewer UUID
  state?: 'unassigned' | 'in_review' | 'completed';
  itemType?: string;        // Filter by item type
  page?: number;            // Default: 1
  limit?: number;           // Default: 20, Max: 100
  sortBy?: 'created_at' | 'priority' | 'updated_at';
  sortOrder?: 'ASC' | 'DESC';
}
```

**Response:**
```typescript
{
  items: ReviewerAssignment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

### 6. Get Assignment Details
**GET** `/reviewer-assignment/:itemId/:itemType`
- **Role Required:** None
- **Description:** Get assignment details for a specific item

**Response:** `ReviewerAssignment` entity

**Errors:**
- `404` - Assignment not found

### 7. Get Audit Logs
**GET** `/reviewer-assignment/:itemId/:itemType/audit-logs`
- **Role Required:** None
- **Description:** Get complete audit trail for an assignment

**Query Parameters:**
```typescript
{
  limit?: number;    // Default: 50
  offset?: number;   // Default: 0
}
```

**Response:**
```typescript
{
  logs: AssignmentAuditLog[];
  total: number;
}
```

### 8. Get Statistics
**GET** `/reviewer-assignment/stats/overview`
- **Role Required:** ADMIN
- **Description:** Get assignment statistics

**Response:**
```typescript
{
  total: number;
  unassigned: number;
  inReview: number;
  completed: number;
  byReviewer: Array<{ reviewerId: string; count: number }>;
}
```

## Service Implementation

### Key Features

#### 1. Concurrency Safety
Uses PostgreSQL pessimistic write locks to prevent race conditions:
```typescript
const lockingQueryBuilder = this.assignmentRepository
  .createQueryBuilder('assignment')
  .where('assignment.id = :id', { id: assignment.id })
  .setLock('pessimistic_write')
  .useTransaction(true);

assignment = await lockingQueryBuilder.getOne();
```

**Benefit:** Multiple simultaneous assignment attempts on the same item are handled safely - only one succeeds, others wait or fail appropriately.

#### 2. Audit Trail
Every assignment change is logged with:
- Previous and new state
- Previous and new reviewer ID
- Actor ID and email
- Reason and metadata
- Immutable timestamp

Audit failures do not disrupt main operations:
```typescript
catch (error) {
  this.logger.error(`Failed to log assignment change`, error);
  // Continue without throwing
}
```

#### 3. State Validation
State machine enforced in service:
```typescript
private getValidTransitions(state: ReviewerAssignmentState): ReviewerAssignmentState[] {
  return {
    [UNASSIGNED]: [IN_REVIEW],
    [IN_REVIEW]: [COMPLETED, UNASSIGNED],
    [COMPLETED]: [UNASSIGNED],
  }[state] || [];
}
```

#### 4. Queue Filtering & Pagination
Efficiently queries assignments with support for:
- Reviewer filtering
- State filtering
- Item type filtering
- Sorting by priority, creation date, or update date
- Pagination with configurable limits

## Testing

### Unit Tests (reviewer-assignment.service.spec.ts)
- 30+ tests covering core service methods
- Tests for state transitions
- Concurrency handling tests
- Audit logging verification
- Queue filtering and sorting

### Controller Tests (reviewer-assignment.controller.spec.ts)
- 15+ tests for API endpoints
- DTO mapping verification
- Error handling
- Response formatting

### E2E Integration Tests (test/reviewer-assignment.e2e.spec.ts)
- 25+ comprehensive workflow tests
- Complete assignment lifecycle
- Reassignment scenarios
- State validation
- Audit trail accuracy
- Queue operations
- Statistics
- Error scenarios

## Migration

### Running Migration
```bash
npm run migration:run
```

### Rolling Back
```bash
npm run migration:revert
```

The migration creates:
- `reviewer_assignment_state_enum` type
- `reviewer_assignments` table
- `assignment_audit_logs` table
- Appropriate foreign key constraints
- Performance indexes

## Usage Examples

### Example 1: Assign Content Report to Reviewer
```typescript
const assignDto: AssignSubmissionDto = {
  itemId: '550e8400-e29b-41d4-a716-446655440000',
  itemType: 'content_report',
  reviewerId: '550e8400-e29b-41d4-a716-446655440001',
  priority: 10,
  reason: 'High-priority spam report'
};

const assignment = await this.service.assignSubmission(
  assignDto,
  adminUserId,
  'admin@lumenpulse.com'
);
```

### Example 2: Get Reviewer's Queue
```typescript
const queue = await this.service.getTriageQueue({
  reviewerId: '550e8400-e29b-41d4-a716-446655440001',
  state: 'in_review',
  sortBy: 'priority',
  sortOrder: 'DESC',
  limit: 20,
  page: 1
});
```

### Example 3: Mark Review as Completed
```typescript
const updateDto: UpdateAssignmentStateDto = {
  state: 'completed',
  reason: 'Content verified and removed'
};

const updated = await this.service.updateAssignmentState(
  itemId,
  itemType,
  updateDto,
  reviewerId,
  'reviewer@lumenpulse.com'
);
```

## Performance Considerations

### Indexes
- `IDX_reviewer_assignments_state` - Fast state filtering
- `IDX_reviewer_assignments_reviewer` - Fast reviewer queue queries
- `IDX_reviewer_assignments_item` - Unique constraint and lookups
- `IDX_reviewer_assignments_priority` - Priority-based sorting
- `IDX_assignment_audit_logs_created` - Audit log ordering

### Query Optimization
- Uses LEFT JOINs for optional relationships (reviewer, assignedBy)
- Efficient pagination with skip/take
- Compound indexes for multi-column sorts
- Pessimistic locks minimize deadlock scenarios

### Audit Log Growth
- Immutable design prevents delete/update operations
- Consider archival strategy for old logs (> 1 year)
- Indexes on `created_at` for range queries

## Security

### Authorization
- `/assign`, `/reassign`, `/unassign` endpoints require ADMIN role
- `/state` endpoint allows REVIEWER or ADMIN
- `/queue`, `/details`, `/audit-logs` endpoints accessible with auth

### Data Protection
- Foreign key constraints ensure referential integrity
- Pessimistic locks prevent race conditions
- Audit trail immutability via CASCADE delete on assignments
- Sensitive data (reviewer emails) properly scoped in responses

### Input Validation
- UUID validation for item/reviewer IDs
- State enum validation
- Priority range validation (0-100)
- DTO validation via class-validator

## Troubleshooting

### Issue: Duplicate Key Violation on Assignment
**Cause:** Item already has an assignment
**Solution:** Use reassign endpoint or unassign first

### Issue: Invalid State Transition Error
**Cause:** Attempting transition not in state machine
**Solution:** Review valid transitions table above

### Issue: Reviewer Not Found
**Cause:** Reviewer ID doesn't exist in users table
**Solution:** Verify reviewer has been created and role is REVIEWER or ADMIN

### Issue: Stale Locks
**Cause:** Concurrent updates causing lock contention
**Solution:** Locks are held briefly; retry logic may be needed in high-concurrency scenarios

## Future Enhancements

1. **Reviewer Load Balancing:** Auto-assign to reviewer with lowest queue count
2. **Priority-Based Assignment:** Automatically assign high-priority items first
3. **SLA Tracking:** Track time in review for metrics
4. **Assignment Escalation:** Auto-escalate overdue assignments
5. **Batch Operations:** Bulk assign/unassign operations
6. **Assignment History:** Track assignment changes (moved to service)
7. **Notifications:** Notify reviewers of assignments via webhook/email
8. **Performance Analytics:** Track reviewer performance metrics

## Related Files

- Migration: `src/database/migrations/1820000000000-CreateReviewerAssignmentSystem.ts`
- Entities: `src/reviewer-assignment/entities/`
- DTOs: `src/reviewer-assignment/dto/`
- Service: `src/reviewer-assignment/reviewer-assignment.service.ts`
- Controller: `src/reviewer-assignment/reviewer-assignment.controller.ts`
- Tests: `src/reviewer-assignment/*.spec.ts`, `test/reviewer-assignment.e2e.spec.ts`

## Contact & Support

For questions or issues, refer to the main backend README.md or contact the development team.
