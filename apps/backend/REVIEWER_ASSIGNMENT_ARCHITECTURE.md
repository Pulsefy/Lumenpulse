# Reviewer Assignment System - Architecture Diagram

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT / FRONTEND                           │
│                  (Web UI, Mobile App, Admin Panel)                  │
└────────────────────────────────────────────────────────┬────────────┘
                                                         │
                                                    JWT Token
                                                         │
                                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    API LAYER (NestJS)                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │          ReviewerAssignmentController                      │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  POST   /assign              (ADMIN)                       │   │
│  │  PATCH  /reassign/:id/:type  (ADMIN)                       │   │
│  │  PATCH  /unassign            (ADMIN)                       │   │
│  │  PATCH  /:id/:type/state     (REVIEWER/ADMIN)              │   │
│  │  GET    /queue               (AUTH)                        │   │
│  │  GET    /:id/:type           (AUTH)                        │   │
│  │  GET    /:id/:type/audit-logs (AUTH)                       │   │
│  │  GET    /stats/overview      (ADMIN)                       │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │    JwtAuthGuard + RolesGuard (Authorization)               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │    ValidationPipe (Input Validation with DTOs)             │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  SERVICE LAYER (Business Logic)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │      ReviewerAssignmentService                             │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │                                                            │   │
│  │  Core Methods:                                             │   │
│  │  • assignSubmission()                                      │   │
│  │  • reassignSubmission()                                    │   │
│  │  • unassignSubmission()                                    │   │
│  │  • updateAssignmentState()                                 │   │
│  │  • getTriageQueue()                                        │   │
│  │  • getAuditLogs()                                          │   │
│  │  • getAssignmentStats()                                    │   │
│  │                                                            │   │
│  │  Features:                                                 │   │
│  │  ✓ State Machine Validation                                │   │
│  │  ✓ Pessimistic Locking (Concurrency)                       │   │
│  │  ✓ Audit Trail Creation                                    │   │
│  │  ✓ JSONB Metadata Support                                  │   │
│  │  ✓ Filtering & Sorting                                     │   │
│  │  ✓ Pagination                                              │   │
│  │  ✓ Statistics Aggregation                                  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │   State Machine Validator                                  │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  UNASSIGNED                                          │  │   │
│  │  │       ▼                                               │  │   │
│  │  │  IN_REVIEW  ◄─┐                                      │  │   │
│  │  │       ▼        │                                      │  │   │
│  │  │  COMPLETED ────┘                                      │  │   │
│  │  │       ▼                                               │  │   │
│  │  │  UNASSIGNED                                           │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                 ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │   Audit Logger                                             │   │
│  │  (Creates immutable audit trail for every change)          │   │
│  └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  DATA ACCESS LAYER (TypeORM)                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │   ReviewerAssignment Repository                         │      │
│  │   (TypeORM Entity with Relationships)                   │      │
│  └─────────────────────────────────────────────────────────┘      │
│                            ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │   AssignmentAuditLog Repository                         │      │
│  │   (Immutable Audit Trail)                              │      │
│  └─────────────────────────────────────────────────────────┘      │
│                            ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │   User Repository                                       │      │
│  │   (Reviewer and Actor Lookup)                           │      │
│  └─────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATABASE LAYER (PostgreSQL)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Tables:                                                            │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐ │
│  │ reviewer_assignments │    │ assignment_audit_logs            │ │
│  ├──────────────────────┤    ├──────────────────────────────────┤ │
│  │ id (UUID, PK)        │    │ id (UUID, PK)                    │ │
│  │ item_id (UUID)       │    │ assignment_id (UUID, FK)         │ │
│  │ item_type (VARCHAR)  │    │ item_id (UUID)                   │ │
│  │ state (ENUM)         │    │ item_type (VARCHAR)              │ │
│  │ reviewer_id (UUID)   │◄───┤ action (VARCHAR)                 │ │
│  │ assigned_by_id (UUID)│    │ previous_state (ENUM)            │ │
│  │ assigned_at (TS)     │    │ new_state (ENUM)                 │ │
│  │ completed_at (TS)    │    │ previous_reviewer_id (UUID, FK)  │ │
│  │ priority (INT)       │    │ new_reviewer_id (UUID, FK)       │ │
│  │ metadata (JSONB)     │    │ actor_id (UUID, FK)              │ │
│  │ created_at (TS)      │    │ actor_email (VARCHAR)            │ │
│  │ updated_at (TS)      │    │ reason (TEXT)                    │ │
│  │                      │    │ metadata (JSONB)                 │ │
│  │ Indexes:             │    │ created_at (TS)                  │ │
│  │ • state              │    │                                  │ │
│  │ • reviewer_id        │    │ Indexes:                         │ │
│  │ • item_id, item_type │    │ • assignment_id                  │ │
│  │ • priority, created  │    │ • actor_id                       │ │
│  │ • created_at         │    │ • item_id, item_type             │ │
│  └──────────────────────┘    │ • created_at                     │ │
│                              └──────────────────────────────────┘ │
│                                                                     │
│  Relationships:                                                     │
│  • reviewer_assignments.reviewer_id → users.id                     │
│  • reviewer_assignments.assigned_by_id → users.id                  │
│  • assignment_audit_logs.assignment_id → reviewer_assignments.id  │
│  • assignment_audit_logs.actor_id → users.id                       │
│  • assignment_audit_logs.new_reviewer_id → users.id                │
│  • assignment_audit_logs.previous_reviewer_id → users.id           │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

### Assign Submission Flow
```
┌─────────────────┐
│  POST /assign   │
└────────┬────────┘
         │
         ▼
   ┌──────────────────────────────┐
   │ JwtAuthGuard + RolesGuard    │
   │ (Check ADMIN role)           │
   └────────┬─────────────────────┘
            │
            ▼
   ┌──────────────────────────────┐
   │ ValidationPipe               │
   │ (Validate AssignSubmissionDto)
   └────────┬─────────────────────┘
            │
            ▼
   ┌──────────────────────────────┐
   │ ReviewerAssignmentService    │
   │ .assignSubmission()          │
   └────────┬─────────────────────┘
            │
            ├─► Verify reviewer exists
            │
            ├─► Get/Create assignment
            │
            ├─► Apply pessimistic write lock
            │
            ├─► Validate state transition (UNASSIGNED → IN_REVIEW)
            │
            ├─► Update assignment record
            │
            ├─► Create audit log entry
            │
            └─► Return updated assignment
                      │
                      ▼
            ┌──────────────────────────────┐
            │ 201 Created                  │
            │ AssignmentResponseDto        │
            └──────────────────────────────┘
```

### Get Triage Queue Flow
```
┌──────────────────────────┐
│  GET /queue              │
│  ?reviewerId=X&state=... │
└────────┬─────────────────┘
         │
         ▼
   ┌──────────────────────────────┐
   │ JwtAuthGuard                 │
   │ (Verify authenticated)       │
   └────────┬─────────────────────┘
            │
            ▼
   ┌──────────────────────────────┐
   │ ReviewerAssignmentService    │
   │ .getTriageQueue()            │
   └────────┬─────────────────────┘
            │
            ├─► Parse query parameters
            │
            ├─► Build TypeORM QueryBuilder
            │
            ├─► Apply filters:
            │   • reviewerId (if provided)
            │   • state (if provided)
            │   • itemType (if provided)
            │
            ├─► Apply sorting:
            │   • priority DESC / created_at DESC / updated_at
            │
            ├─► Apply pagination:
            │   • skip = (page - 1) * limit
            │   • take = limit (max 100)
            │
            ├─► Execute query with LEFT JOINs
            │   (reviewer, assignedBy relationships)
            │
            └─► Return paginated results
                      │
                      ▼
            ┌──────────────────────────────┐
            │ 200 OK                       │
            │ {                            │
            │   items: [...],              │
            │   total: N,                  │
            │   page: 1,                   │
            │   limit: 20,                 │
            │   totalPages: 5              │
            │ }                            │
            └──────────────────────────────┘
```

### State Transition Flow
```
┌──────────────────────────────────────────┐
│  PATCH /:id/:type/state                  │
│  {state: "completed", reason: "..."}     │
└────────┬─────────────────────────────────┘
         │
         ▼
   ┌──────────────────────────────┐
   │ JwtAuthGuard + RolesGuard    │
   │ (Check REVIEWER/ADMIN role)  │
   └────────┬─────────────────────┘
            │
            ▼
   ┌──────────────────────────────┐
   │ UpdateAssignmentStateDto     │
   │ Validation                   │
   └────────┬─────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────┐
   │ ReviewerAssignmentService            │
   │ .updateAssignmentState()             │
   └────────┬──────────────────────────────┘
            │
            ├─► Find assignment by item_id, item_type
            │
            ├─► Apply pessimistic write lock
            │
            ├─► Get valid transitions for current state
            │   • From UNASSIGNED: [IN_REVIEW]
            │   • From IN_REVIEW: [COMPLETED, UNASSIGNED]
            │   • From COMPLETED: [UNASSIGNED]
            │
            ├─► Verify target state is valid
            │   (throw BadRequestException if not)
            │
            ├─► Update assignment.state = target_state
            │
            ├─► If COMPLETED, set completedAt = now()
            │
            ├─► Save assignment record
            │
            ├─► Create audit log with:
            │   • action: "state_changed"
            │   • previousState, newState
            │   • reason, actor info
            │
            └─► Return updated assignment
                      │
                      ▼
            ┌──────────────────────────────┐
            │ 200 OK                       │
            │ AssignmentResponseDto        │
            └──────────────────────────────┘
```

## Concurrency Control

```
┌─────────────────────────────────────────────────────────────────┐
│                   Concurrent Assignment Requests                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Request 1                              Request 2               │
│  ┌──────────────────┐                   ┌──────────────────┐   │
│  │ PATCH /reassign  │                   │ PATCH /:id/state │   │
│  │ (Same item)      │                   │ (Same item)      │   │
│  └────────┬─────────┘                   └────────┬─────────┘   │
│           │                                      │              │
│           ├─ Get Assignment (item_id, item_type) │              │
│           │                                      │              │
│           ├─ Create QueryBuilder                 │              │
│           │  .setLock('pessimistic_write')       │              │
│           │  .useTransaction(true)               │              │
│           │                                      │              │
│           │                    Request 2 tries to lock...       │
│           │                    ⏳ WAITS (blocked by lock)       │
│           │                                      │              │
│           ├─ Lock acquired (transaction 1)       │              │
│           │                                      │              │
│           ├─ Validate & Update state ✓          │              │
│           │                                      │              │
│           ├─ Save record                         │              │
│           │                                      │              │
│           ├─ Create audit log                    │              │
│           │                                      │              │
│           └─ Commit transaction                  │              │
│              (Lock released)                     │              │
│                                                  │              │
│                        Request 2 lock acquired ✓ │              │
│                        ├─ Validate & Update      │              │
│                        ├─ Save record            │              │
│                        ├─ Create audit log       │              │
│                        └─ Commit transaction     │              │
│                                                  │              │
│  Result: Both operations succeed in order       │              │
│  (No race condition, consistent state)          │              │
│                                                 │              │
└─────────────────────────────────────────────────────────────────┘
```

## Error Handling Flow

```
┌────────────────────────────────┐
│ Request to API Endpoint        │
└────────┬───────────────────────┘
         │
         ▼
    ┌─────────────────────────┐
    │ Validation Layer        │
    └────┬──────────────────┬─┘
         │                  │
    Valid│                  │Invalid
         │                  │
         ▼                  ▼
    ┌─────────────────────────┐
    │ Authorization Layer     │
    └────┬──────────────────┬─┘
         │                  │
    Auth │                  │Forbidden
         │                  │
         ▼                  ▼
    ┌──────────────────────────────┐
    │ Service Layer (Business Logic)
    └─┬──┬──┬──┬──┬──────────┬──┬──┘
      │  │  │  │  │          │  │
      │  │  │  │  │          │  └─► 400: Invalid State Transition
      │  │  │  │  │          │
      │  │  │  │  │          └────► 409: Item Already Assigned
      │  │  │  │  │
      │  │  │  │  └────────────────► 404: Reviewer Not Found
      │  │  │  │
      │  │  │  └──────────────────► 404: Assignment Not Found
      │  │  │
      │  │  └─────────────────────► 400: Bad Request
      │  │
      │  └──────────────────────────► 500: Internal Server Error
      │
      └──────────────────────────────► 200/201/204: Success

Success Response Example:
┌─────────────────────────┐
│ 200 OK / 201 Created    │
│ AssignmentResponseDto   │
└─────────────────────────┘

Error Response Example:
┌──────────────────────────────────────┐
│ 400 Bad Request                      │
│ {                                    │
│   "statusCode": 400,                 │
│   "message": "Cannot transition...   │
│   "error": "Bad Request"             │
│ }                                    │
└──────────────────────────────────────┘
```

## Module Integration

```
┌──────────────────────────────────────┐
│         AppModule (NestJS)           │
├──────────────────────────────────────┤
│                                      │
│  imports: [                          │
│    • TypeOrmModule                   │
│    • AuthModule                      │
│    • UsersModule                     │
│    • ModerationModule                │
│    ► ReviewerAssignmentModule  ◄─ NEW
│    • ...other modules                │
│  ]                                   │
│                                      │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  ReviewerAssignmentModule            │
├──────────────────────────────────────┤
│                                      │
│  imports: [                          │
│    TypeOrmModule.forFeature([        │
│      ReviewerAssignment,             │
│      AssignmentAuditLog,             │
│      User                            │
│    ])                                │
│  ]                                   │
│                                      │
│  controllers: [                      │
│    ReviewerAssignmentController      │
│  ]                                   │
│                                      │
│  providers: [                        │
│    ReviewerAssignmentService         │
│  ]                                   │
│                                      │
│  exports: [                          │
│    ReviewerAssignmentService         │
│  ]                                   │
│                                      │
└──────────────────────────────────────┘
```

This architecture provides a clean, maintainable, scalable solution for reviewer assignment management.

