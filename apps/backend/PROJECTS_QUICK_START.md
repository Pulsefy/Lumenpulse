# Project Submissions Feature - Quick Setup Guide

## Files Created

### Entities
- `/workspaces/Lumenpulse/apps/backend/src/projects/entities/project-submission.entity.ts`
- `/workspaces/Lumenpulse/apps/backend/src/projects/entities/review-feedback.entity.ts`

### DTOs
- `/workspaces/Lumenpulse/apps/backend/src/projects/dto/create-project-submission.dto.ts`
- `/workspaces/Lumenpulse/apps/backend/src/projects/dto/update-project-submission.dto.ts`
- `/workspaces/Lumenpulse/apps/backend/src/projects/dto/submit-for-review.dto.ts`
- `/workspaces/Lumenpulse/apps/backend/src/projects/dto/review-submission.dto.ts`
- `/workspaces/Lumenpulse/apps/backend/src/projects/dto/project-submission-response.dto.ts`

### Service Layer
- `/workspaces/Lumenpulse/apps/backend/src/projects/projects.service.ts` (23 methods)

### Controller
- `/workspaces/Lumenpulse/apps/backend/src/projects/projects.controller.ts` (14 endpoints)

### Module
- `/workspaces/Lumenpulse/apps/backend/src/projects/projects.module.ts`

### Guards
- `/workspaces/Lumenpulse/apps/backend/src/projects/guards/reviewer.guard.ts`

### Database
- `/workspaces/Lumenpulse/apps/backend/src/database/migrations/1713868800000-CreateProjectSubmissionTables.ts`

### Documentation
- `/workspaces/Lumenpulse/apps/backend/PROJECTS_WORKFLOW_IMPLEMENTATION.md` (comprehensive guide)

## Quick Start

### 1. Verify Module Registration
✓ Already updated `/workspaces/Lumenpulse/apps/backend/src/app.module.ts`

### 2. Run Migration
```bash
cd /workspaces/Lumenpulse/apps/backend
npm run migration:run
```

### 3. Start Backend
```bash
npm run start:dev
```

### 4. Test Endpoints
```bash
# Create a draft
curl -X POST http://localhost:8000/api/projects/submissions/draft \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Project",
    "description": "A great project",
    "projectType": "other"
  }'

# View published projects (no auth needed)
curl http://localhost:8000/api/projects/published
```

## API Summary

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| POST | `/submissions/draft` | Creator | Create new draft |
| POST | `/submissions/{id}/update` | Creator | Update draft/changes_requested |
| POST | `/submissions/{id}/submit-for-review` | Creator | Submit for review |
| GET | `/submissions/{id}` | All | View submission details |
| GET | `/my-submissions` | Creator | View own submissions |
| GET | `/submissions-for-review` | Admin | View pending reviews |
| POST | `/submissions/{id}/request-changes` | Admin | Request changes |
| POST | `/submissions/{id}/approve` | Admin | Approve submission |
| POST | `/submissions/{id}/reject` | Admin | Reject submission |
| POST | `/submissions/{id}/publish` | Admin | Publish to public |
| GET | `/published` | Public | View all published projects |
| POST | `/submissions/{id}/comments` | Admin | Add comments |
| POST | `/feedback/{id}/resolve` | All | Mark feedback resolved |
| DELETE | `/submissions/{id}` | Creator | Delete draft |

## Workflow States

```
DRAFT ──submit──> UNDER_REVIEW ──request──> CHANGES_REQUESTED
                      ├──approve──> APPROVED ──publish──> PUBLISHED
                      └──reject──> REJECTED
```

## Key Features

✅ **Draft Management**: Save work in progress  
✅ **Review System**: Multiple reviewers can provide feedback  
✅ **State Machine**: Enforced workflow states  
✅ **Version Tracking**: Track submission revisions  
✅ **Role-Based Access**: Creator, Reviewer, Admin roles  
✅ **Soft Deletes**: Audit trail preserved  
✅ **Pagination**: Efficient data retrieval  
✅ **Validation**: Input and state validation  
✅ **Error Handling**: Comprehensive error responses  
✅ **Public View**: Published projects accessible without auth

## Testing

Run the comprehensive test suite:
```bash
# Unit tests
npm test -- projects

# E2E tests
npm run test:e2e
```

Visit `PROJECTS_WORKFLOW_IMPLEMENTATION.md` for:
- Complete API documentation
- Testing procedures
- cURL examples
- Jest test templates
- Troubleshooting guide
