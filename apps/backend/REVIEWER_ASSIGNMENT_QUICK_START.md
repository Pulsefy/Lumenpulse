# Reviewer Assignment API - Quick Start Guide

## Installation

```bash
cd apps/backend
npm install
npm run migration:run  # Create database tables
```

## Quick Setup

### 1. Import Module
```typescript
// app.module.ts
import { ReviewerAssignmentModule } from './reviewer-assignment/reviewer-assignment.module';

@Module({
  imports: [
    // ... other modules
    ReviewerAssignmentModule,
  ],
})
export class AppModule {}
```

### 2. Test the Endpoints
```bash
npm test -- --testPathPattern="reviewer-assignment"
```

**Expected**: 26 tests passing ✅

## Core Operations

### Assign Item to Reviewer
```bash
curl -X POST http://localhost:3000/reviewer-assignment/assign \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "item-uuid",
    "itemType": "content_report",
    "reviewerId": "reviewer-uuid",
    "priority": 5,
    "reason": "Urgent spam report"
  }'
```

### Get Reviewer's Queue
```bash
curl -X GET "http://localhost:3000/reviewer-assignment/queue?reviewerId=<reviewer-uuid>&state=in_review&limit=20" \
  -H "Authorization: Bearer <token>"
```

### Mark as Completed
```bash
curl -X PATCH http://localhost:3000/reviewer-assignment/<itemId>/<itemType>/state \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "state": "completed",
    "reason": "Review complete"
  }'
```

### View Audit Trail
```bash
curl -X GET "http://localhost:3000/reviewer-assignment/<itemId>/<itemType>/audit-logs?limit=10" \
  -H "Authorization: Bearer <token>"
```

## State Machine Reference

```
UNASSIGNED (initial state)
    ↓
    → IN_REVIEW (assigned to reviewer)
         ↓
         → COMPLETED (review finished)
               ↓
               → UNASSIGNED (reopen or restart)
    ↑
    └─ Can skip directly to UNASSIGNED (early unassign)
```

## Common Workflows

### Workflow 1: Triage New Report
1. **Assign**: `POST /reviewer-assignment/assign` (Admin)
2. **Review**: Reviewer views queue via `GET /reviewer-assignment/queue`
3. **Complete**: `PATCH /reviewer-assignment/:itemId/:itemType/state` (Reviewer)

### Workflow 2: Reassign Stuck Item
1. **Get**: `GET /reviewer-assignment/:itemId/:itemType` (Admin)
2. **Reassign**: `PATCH /reviewer-assignment/reassign/:itemId/:itemType` (Admin)
3. **Track**: `GET /reviewer-assignment/:itemId/:itemType/audit-logs`

### Workflow 3: Get Reviewer Stats
1. **Count**: `GET /reviewer-assignment/stats/overview` (Admin)
2. **Analyze**: See which reviewers are overloaded
3. **Rebalance**: Reassign items to less busy reviewers

## Key Concepts

**Assignment States**:
- `unassigned`: Not assigned to anyone (initial state)
- `in_review`: Assigned to a reviewer, actively being reviewed
- `completed`: Review finished, can be reopened if needed

**Assignment Data**:
- `reviewerId`: UUID of assigned reviewer (null if unassigned)
- `assignedBy`: Who made the assignment (admin ID)
- `priority`: 0-100 (higher = more urgent)
- `metadata`: Custom data (JSONB - can store anything)

**Audit Trail**:
- Every change is logged with: who, what, when, why
- Immutable (can't be deleted)
- Queries: `/audit-logs` endpoint

## Required Roles

| Endpoint | Role |
|----------|------|
| POST /assign | ADMIN |
| PATCH /reassign | ADMIN |
| PATCH /unassign | ADMIN |
| PATCH /:id/state | REVIEWER or ADMIN |
| GET /queue | Any authenticated user |
| GET /:id | Any authenticated user |
| GET /audit-logs | Any authenticated user |
| GET /stats | ADMIN |

## Performance Tips

### Query Optimization
```typescript
// Good: Use filters and pagination
GET /reviewer-assignment/queue?state=in_review&limit=20&page=1

// Avoid: No limit (default: 20, max: 100)
GET /reviewer-assignment/queue
```

### Sorting Options
```typescript
// By priority (fastest for small queues)
sortBy=priority&sortOrder=DESC

// By creation date (best for recent items)
sortBy=created_at&sortOrder=DESC

// By update date (find recently changed)
sortBy=updated_at&sortOrder=DESC
```

### Pagination Strategy
```typescript
// Page through large results
for (let page = 1; page <= totalPages; page++) {
  GET /reviewer-assignment/queue?page=${page}&limit=50
}
```

## Troubleshooting

### 404: Reviewer not found
- Check reviewer ID is valid UUID
- Verify reviewer exists in users table
- Ensure user has REVIEWER or ADMIN role

### 400: Invalid state transition
- Review current state with `GET /reviewer-assignment/:id/:type`
- Check state machine transitions (see above)
- Can't jump states directly (e.g., UNASSIGNED → COMPLETED)

### 409: Item already assigned
- Item already has an assignment
- Use `PATCH /reassign` instead of `POST /assign`
- Or `PATCH /unassign` first, then `POST /assign`

### 401: Unauthorized
- Missing Authorization header
- Invalid/expired JWT token
- Try: `Authorization: Bearer <your-jwt-token>`

### 403: Forbidden
- Insufficient permissions for this endpoint
- Check role requirements in table above
- Admin users can access all endpoints

## Database Details

### Tables Created
- `reviewer_assignments` - Current assignment state
- `assignment_audit_logs` - Audit trail (immutable)

### Indexes
- state, reviewer_id, item_id, priority, created_at
- Optimized for common queries

### Foreign Keys
- `reviewer_id` → `users.id`
- `assigned_by_id` → `users.id`
- `actor_id` → `users.id` (in audit logs)

## Testing

```bash
# Run all reviewer assignment tests
npm test -- --testPathPattern="reviewer-assignment"

# Run with coverage
npm test -- --coverage --testPathPattern="reviewer-assignment"

# Watch mode (auto-rerun on changes)
npm test -- --watch --testPathPattern="reviewer-assignment"

# E2E tests
npm run test:e2e -- --testPathPattern="reviewer-assignment"
```

## Files Structure

```
src/reviewer-assignment/
├── entities/
│   ├── reviewer-assignment.entity.ts
│   └── assignment-audit-log.entity.ts
├── dto/
│   ├── assign-submission.dto.ts
│   ├── reassign-submission.dto.ts
│   ├── unassign-submission.dto.ts
│   ├── update-assignment-state.dto.ts
│   ├── query-triage-queue.dto.ts
│   └── assignment-response.dto.ts
├── reviewer-assignment.service.ts
├── reviewer-assignment.controller.ts
├── reviewer-assignment.module.ts
├── reviewer-assignment.service.spec.ts
├── reviewer-assignment.controller.spec.ts
├── IMPLEMENTATION_GUIDE.md
└── README.md
```

## Next Steps

1. ✅ **Setup**: Run migrations
2. ✅ **Test**: Run test suite
3. 📖 **Read**: Review IMPLEMENTATION_GUIDE.md
4. 🚀 **Deploy**: Push changes to staging
5. 📊 **Monitor**: Check queue stats regularly
6. 🔄 **Integrate**: Connect to moderation reports workflow

## Support

- **Implementation Details**: See `IMPLEMENTATION_GUIDE.md`
- **API Docs**: See `ISSUE_1078_IMPLEMENTATION_SUMMARY.md`
- **Tests**: Check `*.spec.ts` files for usage examples
- **Questions**: Review test files for working examples

