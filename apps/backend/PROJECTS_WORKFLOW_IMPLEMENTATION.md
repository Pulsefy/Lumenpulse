# Project Submissions & Review Workflow Implementation

## Overview

This document covers the complete implementation of the **Draft and Review States Workflow** for project submissions in LumenPulse. The system allows creators to save work as drafts, submit for review, and only approved projects are published. Reviewers can request changes, approve, or reject submissions.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Workflow States](#workflow-states)
5. [Testing Guide](#testing-guide)
6. [Integration Steps](#integration-steps)
7. [Usage Examples](#usage-examples)

---

## Architecture

### Entities

#### ProjectSubmission
- **Table**: `project_submissions`
- **Purpose**: Stores project submission data with version control and status tracking
- **Key Fields**:
  - `id`: UUID primary key
  - `creatorId`: UUID foreign key to users table
  - `title`, `description`, `detailedContent`: Project information
  - `projectType`: Enum (news_aggregator, portfolio_tracker, trading_bot, defi_protocol, educational, other)
  - `status`: Enum (draft, under_review, changes_requested, approved, rejected, published)
  - `repositoryUrl`, `liveUrl`: Project URLs
  - `metadata`: JSON field for additional data (cover letter, screenshots, etc.)
  - `reviewedById`: UUID reference to reviewer (admin)
  - `version`: Integer counter for tracking revisions
  - Timestamps: `createdAt`, `updatedAt`, `submittedAt`, `publishedAt`, `rejectedAt`, `deletedAt` (soft delete)

#### ReviewFeedback
- **Table**: `review_feedback`
- **Purpose**: Stores feedback and comments from reviewers
- **Key Fields**:
  - `id`: UUID primary key
  - `submissionId`: UUID foreign key to project_submissions
  - `reviewerId`: UUID foreign key to users table
  - `type`: Enum (comment, request_changes, approval, rejection)
  - `message`: Feedback text
  - `suggestions`: JSON field for detailed suggestions
  - `isResolved`: Boolean flag for marking feedback as resolved
  - Timestamps: `createdAt`, `updatedAt`

### Services

#### ProjectSubmissionsService
Located: `/workspaces/Lumenpulse/apps/backend/src/projects/projects.service.ts`

**Key Methods**:
- `createDraft()`: Create a new draft submission
- `updateDraft()`: Update existing draft or changes_requested submissions
- `submitForReview()`: Change status to under_review
- `getSubmissionById()`: Retrieve submission with related data
- `listSubmissions()`: Query submissions with filtering and pagination
- `requestChanges()`: Reviewer action to request changes
- `approveSubmission()`: Reviewer action to approve
- `rejectSubmission()`: Reviewer action to reject
- `publishSubmission()`: Admin action to publish approved submission
- `deleteDraft()`: Delete draft submissions
- `addComment()`: Add comments to submissions
- `resolveFeedback()`: Mark feedback as resolved

### Controllers

#### ProjectSubmissionsController
Located: `/workspaces/Lumenpulse/apps/backend/src/projects/projects.controller.ts`

Provides REST API endpoints with JWT authentication and reviewer role guards.

### Guards

#### ReviewerGuard
- Verifies user has ADMIN role
- Used on all reviewer-only endpoints

---

## Database Schema

### project_submissions Table

```sql
CREATE TABLE project_submissions (
  id UUID PRIMARY KEY,
  creatorId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  detailedContent TEXT,
  projectType ENUM ('news_aggregator', 'portfolio_tracker', 'trading_bot', 'defi_protocol', 'educational', 'other'),
  status ENUM ('draft', 'under_review', 'changes_requested', 'approved', 'rejected', 'published'),
  repositoryUrl VARCHAR(255),
  liveUrl VARCHAR(255),
  metadata JSON,
  reviewedById UUID REFERENCES users(id) ON DELETE SET NULL,
  submittedAt TIMESTAMP,
  publishedAt TIMESTAMP,
  rejectedAt TIMESTAMP,
  version INT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedAt TIMESTAMP
);

-- Indexes
CREATE INDEX idx_project_submissions_creatorId ON project_submissions(creatorId);
CREATE INDEX idx_project_submissions_status ON project_submissions(status);
CREATE INDEX idx_project_submissions_createdAt ON project_submissions(createdAt);
CREATE INDEX idx_project_submissions_creatorId_status ON project_submissions(creatorId, status);
```

### review_feedback Table

```sql
CREATE TABLE review_feedback (
  id UUID PRIMARY KEY,
  submissionId UUID NOT NULL REFERENCES project_submissions(id) ON DELETE CASCADE,
  reviewerId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type ENUM ('comment', 'request_changes', 'approval', 'rejection'),
  message TEXT NOT NULL,
  suggestions JSON,
  isResolved BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_review_feedback_submissionId ON review_feedback(submissionId);
CREATE INDEX idx_review_feedback_reviewerId ON review_feedback(reviewerId);
CREATE INDEX idx_review_feedback_createdAt ON review_feedback(createdAt);
CREATE INDEX idx_review_feedback_submissionId_reviewerId ON review_feedback(submissionId, reviewerId);
```

---

## API Endpoints

### Base Path
```
/api/projects
```

### Endpoints

#### 1. Create Draft Submission
```http
POST /api/projects/submissions/draft
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "title": "My Awesome Trading Bot",
  "description": "A high-frequency trading bot powered by ML",
  "detailedContent": "Detailed implementation...",
  "projectType": "trading_bot",
  "repositoryUrl": "https://github.com/user/trading-bot",
  "liveUrl": "https://tradingbot.example.com",
  "metadata": {
    "features": ["ML predictions", "Real-time alerts"]
  }
}

Response: 201 Created
{
  "id": "uuid",
  "creatorId": "uuid",
  "title": "My Awesome Trading Bot",
  "status": "draft",
  "version": 0,
  ...
}
```

#### 2. Update Draft Submission
```http
POST /api/projects/submissions/{id}/update
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description"
}

Response: 200 OK
```

#### 3. Submit for Review
```http
POST /api/projects/submissions/{id}/submit-for-review
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "coverLetter": "I believe this project brings great value..."
}

Response: 200 OK
{
  "status": "under_review",
  "submittedAt": "2024-04-24T10:30:00Z"
}
```

#### 4. Get Submission Details
```http
GET /api/projects/submissions/{id}
Authorization: Bearer <JWT_TOKEN>

Response: 200 OK
{
  "id": "uuid",
  "title": "...",
  "status": "under_review",
  "reviewFeedback": [
    {
      "id": "uuid",
      "type": "comment",
      "message": "Great project!",
      "createdAt": "2024-04-24T10:35:00Z"
    }
  ]
}
```

#### 5. Get User's Submissions
```http
GET /api/projects/my-submissions?page=1&limit=10
Authorization: Bearer <JWT_TOKEN>

Response: 200 OK
{
  "data": [...],
  "total": 5,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

#### 6. Get Submissions for Review (Admin)
```http
GET /api/projects/submissions-for-review?page=1&limit=10
Authorization: Bearer <ADMIN_JWT_TOKEN>

Response: 200 OK
{
  "data": [...],
  "total": 3,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

#### 7. Request Changes (Reviewer Action)
```http
POST /api/projects/submissions/{id}/request-changes
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "type": "request_changes",
  "message": "Please add more documentation and improve the UI",
  "suggestions": {
    "documentation": "Add API docs",
    "ui": "Improve dashboard responsiveness"
  }
}

Response: 200 OK
{
  "status": "changes_requested",
  "reviewedById": "admin-uuid"
}
```

#### 8. Approve Submission (Reviewer Action)
```http
POST /api/projects/submissions/{id}/approve
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "type": "approval",
  "message": "Excellent work! This project is ready for publishing."
}

Response: 200 OK
{
  "status": "approved"
}
```

#### 9. Reject Submission (Reviewer Action)
```http
POST /api/projects/submissions/{id}/reject
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "type": "rejection",
  "message": "This project does not meet our standards..."
}

Response: 200 OK
{
  "status": "rejected",
  "rejectedAt": "2024-04-24T11:00:00Z"
}
```

#### 10. Publish Submission (Admin)
```http
POST /api/projects/submissions/{id}/publish
Authorization: Bearer <ADMIN_JWT_TOKEN>

Response: 200 OK
{
  "status": "published",
  "publishedAt": "2024-04-24T11:05:00Z"
}
```

#### 11. Get Published Projects (Public)
```http
GET /api/projects/published?page=1&limit=20

Response: 200 OK
{
  "data": [...],
  "total": 15,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

#### 12. Add Comment to Submission
```http
POST /api/projects/submissions/{id}/comments
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "message": "Have you considered adding Stellar integration?"
}

Response: 201 Created
{
  "id": "uuid",
  "type": "comment",
  "message": "..."
}
```

#### 13. Resolve Feedback
```http
POST /api/projects/feedback/{feedbackId}/resolve
Authorization: Bearer <JWT_TOKEN>

Response: 200 OK
{
  "isResolved": true
}
```

#### 14. Delete Draft
```http
DELETE /api/projects/submissions/{id}
Authorization: Bearer <JWT_TOKEN>

Response: 204 No Content
```

---

## Workflow States

### State Transition Diagram

```
┌─────────┐
│ DRAFT ◄─┼─── CHANGES_REQUESTED
└────┬────┘
     │ submit-for-review
     ▼
┌────────────────┐
│ UNDER_REVIEW   │
└────┬────┬──────┘
     │    │
     │    └──► CHANGES_REQUESTED (request-changes)
     │    └──► REJECTED (reject)
     │
     └──► APPROVED (approve)
          │
          └──► PUBLISHED (publish)
```

### State Descriptions

| State | Description | Allowed Actions | Created By |
|-------|-------------|-----------------|-----------|
| **DRAFT** | Initial state, submission is being created | Update, delete, submit-for-review | Creator |
| **UNDER_REVIEW** | Submitted for review, awaiting reviewer feedback | Request changes, approve, reject | System (after submit) |
| **CHANGES_REQUESTED** | Reviewer requested modifications | Update, submit-for-review, delete | Reviewer |
| **APPROVED** | Reviewer approved the submission | Publish | System (after approve) |
| **REJECTED** | Reviewer rejected the submission | Create new draft | System (after reject) |
| **PUBLISHED** | Published to public view | None | Admin (after publish) |

---

## Testing Guide

### Setup

1. **Run Database Migration**
```bash
cd /workspaces/Lumenpulse/apps/backend
npm run migration:run
```

2. **Start Backend Server**
```bash
npm run start:dev
```

3. **Get JWT Tokens**
- Login as creator user (regular user)
- Login as reviewer/admin user

### Manual Testing with cURL

#### Test 1: Create Draft Submission

```bash
curl -X POST http://localhost:8000/api/projects/submissions/draft \
  -H "Authorization: Bearer {CREATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "DeFi Protocol Implementation",
    "description": "A comprehensive DeFi protocol built on Stellar",
    "projectType": "defi_protocol",
    "repositoryUrl": "https://github.com/user/defi-protocol"
  }'
```

**Expected Response**: 201 Created with submission object

#### Test 2: Update Draft

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/update \
  -H "Authorization: Bearer {CREATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated DeFi Protocol",
    "liveUrl": "https://defi-protocol.example.com"
  }'
```

**Expected Response**: 200 OK with updated submission

#### Test 3: Submit for Review

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/submit-for-review \
  -H "Authorization: Bearer {CREATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "coverLetter": "This project demonstrates advanced Stellar integration with smart contracts"
  }'
```

**Expected Response**: 200 OK with status changed to "under_review"

#### Test 4: Get Submissions for Review (Reviewer)

```bash
curl -X GET http://localhost:8000/api/projects/submissions-for-review?page=1&limit=10 \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Expected Response**: 200 OK with list of under_review submissions

#### Test 5: Request Changes

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/request-changes \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "request_changes",
    "message": "Please add comprehensive testing and security audit",
    "suggestions": {
      "testing": "Add unit tests with 80%+ coverage",
      "security": "Include security audit report"
    }
  }'
```

**Expected Response**: 200 OK with status changed to "changes_requested"

#### Test 6: Check User's Submissions

```bash
curl -X GET http://localhost:8000/api/projects/my-submissions?page=1&limit=5 \
  -H "Authorization: Bearer {CREATOR_TOKEN}"
```

**Expected Response**: 200 OK with user's submissions including the one with "changes_requested" status

#### Test 7: Update Modified Submission

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/update \
  -H "Authorization: Bearer {CREATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "detailedContent": "Added comprehensive test suite and security audit report. 85% test coverage achieved."
  }'
```

**Expected Response**: 200 OK with updated submission and incremented version

#### Test 8: Resubmit for Review

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/submit-for-review \
  -H "Authorization: Bearer {CREATOR_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "coverLetter": "Updated with comprehensive testing and security improvements"
  }'
```

**Expected Response**: 200 OK with status back to "under_review"

#### Test 9: Approve Submission

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/approve \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "approval",
    "message": "Excellent improvements! This is ready for publication."
  }'
```

**Expected Response**: 200 OK with status changed to "approved"

#### Test 10: Publish Submission

```bash
curl -X POST http://localhost:8000/api/projects/submissions/{SUBMISSION_ID}/publish \
  -H "Authorization: Bearer {ADMIN_TOKEN}"
```

**Expected Response**: 200 OK with status changed to "published" and publishedAt timestamp set

#### Test 11: View Published Projects (Public)

```bash
curl -X GET http://localhost:8000/api/projects/published?page=1&limit=10
```

**Expected Response**: 200 OK with list of published projects (no authentication required)

#### Test 12: Test Authorization

Try accessing admin endpoints without admin token:

```bash
curl -X GET http://localhost:8000/api/projects/submissions-for-review \
  -H "Authorization: Bearer {CREATOR_TOKEN}"
```

**Expected Response**: 403 Forbidden

---

### Jest Unit Tests Template

Create `/workspaces/Lumenpulse/apps/backend/test/projects.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectSubmissionsService } from '../src/projects/projects.service';
import { ProjectSubmission, SubmissionStatus, ProjectType } from '../src/projects/entities/project-submission.entity';
import { ReviewFeedback } from '../src/projects/entities/review-feedback.entity';
import { CreateProjectSubmissionDto } from '../src/projects/dto/create-project-submission.dto';

describe('ProjectSubmissionsService', () => {
  let service: ProjectSubmissionsService;
  let submissionRepo: Repository<ProjectSubmission>;
  let feedbackRepo: Repository<ReviewFeedback>;

  const mockSubmissionRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
    softRemove: jest.fn(),
  };

  const mockFeedbackRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectSubmissionsService,
        {
          provide: getRepositoryToken(ProjectSubmission),
          useValue: mockSubmissionRepository,
        },
        {
          provide: getRepositoryToken(ReviewFeedback),
          useValue: mockFeedbackRepository,
        },
      ],
    }).compile();

    service = module.get<ProjectSubmissionsService>(ProjectSubmissionsService);
    submissionRepo = module.get<Repository<ProjectSubmission>>(
      getRepositoryToken(ProjectSubmission),
    );
    feedbackRepo = module.get<Repository<ReviewFeedback>>(
      getRepositoryToken(ReviewFeedback),
    );
  });

  describe('createDraft', () => {
    it('should create a new draft submission', async () => {
      const creatorId = 'user-uuid';
      const createDto: CreateProjectSubmissionDto = {
        title: 'Test Project',
        description: 'A test project description',
        projectType: ProjectType.OTHER,
      };

      const createdSubmission = {
        id: 'submission-uuid',
        creatorId,
        ...createDto,
        status: SubmissionStatus.DRAFT,
        version: 0,
        metadata: {},
      };

      mockSubmissionRepository.create.mockReturnValue(createdSubmission);
      mockSubmissionRepository.save.mockResolvedValue(createdSubmission);

      const result = await service.createDraft(creatorId, createDto);

      expect(result.status).toBe(SubmissionStatus.DRAFT);
      expect(result.creatorId).toBe(creatorId);
      expect(mockSubmissionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          creatorId,
          status: SubmissionStatus.DRAFT,
        }),
      );
    });
  });

  describe('submitForReview', () => {
    it('should change status from draft to under_review', async () => {
      const submissionId = 'submission-uuid';
      const creatorId = 'user-uuid';

      const submission = {
        id: submissionId,
        creatorId,
        status: SubmissionStatus.DRAFT,
        version: 0,
      };

      mockSubmissionRepository.findOne.mockResolvedValue(submission);
      mockSubmissionRepository.save.mockResolvedValue({
        ...submission,
        status: SubmissionStatus.UNDER_REVIEW,
        version: 1,
        submittedAt: new Date(),
      });

      const result = await service.submitForReview(submissionId, creatorId, {});

      expect(result.status).toBe(SubmissionStatus.UNDER_REVIEW);
      expect(result.version).toBe(1);
    });
  });

  describe('approveSubmission', () => {
    it('should approve a submission and save feedback', async () => {
      const submissionId = 'submission-uuid';
      const reviewerId = 'admin-uuid';

      mockSubmissionRepository.findOne.mockResolvedValue({
        id: submissionId,
        status: SubmissionStatus.UNDER_REVIEW,
        version: 2,
      });

      mockSubmissionRepository.save.mockResolvedValue({
        id: submissionId,
        status: SubmissionStatus.APPROVED,
        version: 3,
      });

      mockFeedbackRepository.create.mockReturnValue({
        submissionId,
        reviewerId,
        type: 'approval',
      });

      const result = await service.approveSubmission(submissionId, reviewerId, {
        type: FeedbackType.APPROVAL,
        message: 'Looks good!',
      });

      expect(result.status).toBe(SubmissionStatus.APPROVED);
      expect(mockFeedbackRepository.save).toHaveBeenCalled();
    });
  });
});
```

### Postman Collection

Import this collection into Postman to test all endpoints:

```json
{
  "info": {
    "name": "Project Submissions API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Create Draft",
      "request": {
        "method": "POST",
        "url": "{{base_url}}/api/projects/submissions/draft",
        "header": [
          {"key": "Authorization", "value": "Bearer {{creator_token}}"},
          {"key": "Content-Type", "value": "application/json"}
        ],
        "body": {
          "mode": "raw",
          "raw": "{\"title\": \"Test Project\", \"description\": \"Test description\", \"projectType\": \"other\"}"
        }
      }
    }
  ]
}
```

---

## Integration Steps

### Step 1: Apply Database Migration

```bash
cd /workspaces/Lumenpulse/apps/backend
npm run migration:run
```

### Step 2: Verify Module Import

Check `/workspaces/Lumenpulse/apps/backend/src/app.module.ts` includes:
```typescript
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    // ... other imports
    ProjectsModule,
  ],
})
```

### Step 3: Test API

```bash
# Start the backend
npm run start:dev

# In another terminal, test an endpoint
curl -X GET http://localhost:8000/api/projects/published
```

### Step 4: Run Unit Tests

```bash
npm test -- projects
```

---

## Usage Examples

### Example 1: Full Workflow - Creator to Published

```
Creator (Alice) submits a trading bot project:

1. CREATE DRAFT
   - POST /projects/submissions/draft
   - Alice creates and saves her project as draft

2. UPDATE DRAFT
   - POST /projects/submissions/{id}/update
   - Alice refines her project

3. SUBMIT FOR REVIEW
   - POST /projects/submissions/{id}/submit-for-review
   - Alice submits her project, status → "under_review"

4. REVIEWER FEEDBACK (Bob - Admin)
   - GET /projects/submissions-for-review (Bob sees pendings)
   - Bob reviews and requests changes
   - POST /projects/submissions/{id}/request-changes
   - Status → "changes_requested"

5. CREATOR UPDATES
   - Alice sees her project status
   - GET /projects/my-submissions
   - Alice updates her project
   - POST /projects/submissions/{id}/update

6. RESUBMIT
   - Alice resubmits
   - POST /projects/submissions/{id}/submit-for-review
   - Status back to "under_review"

7. APPROVAL
   - Bob approves
   - POST /projects/submissions/{id}/approve
   - Status → "approved"

8. PUBLISHING
   - Admin publishes
   - POST /projects/submissions/{id}/publish
   - Status → "published"

9. PUBLIC VIEWING
   - Anyone can see published projects
   - GET /projects/published
```

### Example 2: Rejection Workflow

```
Reviewer rejects a submission:

1. POST /projects/submissions/{id}/reject
   - Status → "rejected"
   - Creator notified
   - Creator can create a new draft and resubmit
```

---

## Validation & Error Handling

### Input Validation

- Title: 5-255 characters
- Description: minimum 20 characters
- URLs: Valid URL format
- Enum values: Must match defined options

### Error Responses

```json
{
  "statusCode": 400,
  "message": "Cannot edit submission with status: under_review",
  "error": "Bad Request"
}
```

```json
{
  "statusCode": 403,
  "message": "You can only edit your own submissions",
  "error": "Forbidden"
}
```

```json
{
  "statusCode": 404,
  "message": "Submission not found",
  "error": "Not Found"
}
```

---

## Performance Considerations

1. **Indexes**: All frequently queried columns are indexed
2. **Pagination**: List endpoints default to 10 items per page
3. **Relations**: Lazy load reviews only when needed
4. **Soft Deletes**: Preserve audit trail

---

## Future Enhancements

1. **Notifications**: Email creators when status changes
2. **File Uploads**: Support project screenshots/documentation
3. **Revision History**: Full audit log of changes
4. **Bulk Operations**: Approve/reject multiple submissions
5. **Search & Filtering**: Advanced search by tags, type, date range
6. **Rating System**: Community ratings for published projects
7. **Webhooks**: Notify external systems on status changes

---

## Troubleshooting

### Migration Won't Run

```bash
# Check for existing tables
SELECT * FROM information_schema.tables WHERE table_name = 'project_submissions';

# If exists, revert
npm run migration:revert
npm run migration:run
```

### Forbidden Errors on Reviewer Endpoints

Ensure the token belongs to an ADMIN user:
```bash
# Check user role in database
SELECT id, email, role FROM users WHERE id = 'user-id';
```

### Submissions Not Appearing

Check filters and status values:
```bash
# Query directly
SELECT * FROM project_submissions WHERE status = 'draft';
```

---

## Summary

The project submission workflow is now fully implemented with:

✅ Database schema and migrations  
✅ Service layer with business logic  
✅ REST API endpoints  
✅ JWT authentication  
✅ Role-based access control  
✅ Comprehensive error handling  
✅ Pagination and filtering  
✅ Soft delete support  
✅ Version tracking  
✅ Review feedback system  
✅ Full state management workflow
