# Verification review workspace

The webapp route `/verification/review` is where reviewers work through incoming
verification requests (`apps/backend/src/verification-requests`). Reviewers and
admins also get a "Review verification requests" link on `/verification`.

## Access

- The page sits behind `AuthGate`, so signed-out visitors are sent to the login page.
- The workspace reads the role from the `auth-token` JWT (`lib/auth-role.ts`).
  - Only `reviewer` and `admin` see the queue.
  - Everyone else sees "Reviewer access required", and no request is sent.
- This check only decides what the UI shows. The backend `RolesGuard` still
  enforces access on `GET /verification-requests` and `PATCH /verification-requests/:id/status`.

## What a reviewer sees

Each request card shows:

- the target type and id, its status, and when it was submitted;
- the evidence and the requester's note;
- the community vote state;
- the last review note.

### Vote state

Verification requests carry no votes of their own. The only votes are on the
on-chain project registry, so the card shows what fits the target:

| Target | What the card shows |
|---|---|
| `PROJECT` with a numeric id | The registry tally from `GET /verification/projects/:id`: for and against votes, quorum progress, and registry status |
| `PROJECT` with no registry entry | A note saying there is no vote yet |
| `CONTRIBUTOR` | A note saying contributor requests have no community vote |

### Filters

The queue defaults to **Pending**, which covers `SUBMITTED`, `IN_REVIEW` and
`CHANGES_REQUESTED`. Tabs narrow it to a single status, or show all requests.
The API returns requests oldest first.

## Recording a decision

The buttons offered are the transitions the backend allows:

| From | Decisions |
|---|---|
| `SUBMITTED` | Start review (`IN_REVIEW`) |
| `IN_REVIEW` | Request changes, Approve, Reject |
| `CHANGES_REQUESTED` | Start review (`IN_REVIEW`) |
| `APPROVED`, `REJECTED`, `CANCELLED` | None |

**Rationale**
- Required for Approve, Reject and Request changes; optional for Start review.
- Sent as `reviewNote`.
- The backend replaces `reviewNote` on every transition. Starting a review
  without a rationale clears the previous note.

**Retries:** each submit sends an `Idempotency-Key` header, so retrying a
submit does not record the decision twice.

**Errors:** if the backend rejects a decision (for example, another reviewer
already moved the request), its message is shown on the card.

## Live updates

- **After a decision:** the card takes the server's response immediately, with
  no page reload. A request that leaves the current filter (for example,
  Approved while on Pending) drops out of the list. A screen-reader status line
  announces the new state.
- **Other reviewers' changes:** the queue refreshes every 15 seconds while the
  tab is visible. There is also a manual refresh button.
- **Failed refresh:** the last loaded list stays on screen and a short note
  says the refresh failed.

## Evidence links

Evidence is free text written by the requester. `lib/evidence-links.ts` turns
only absolute `http:` / `https:` URLs without credentials into links. Anything
else, including `javascript:`, `data:` and relative paths, stays plain text.

Links open in a new tab with these attributes:

- `rel="noopener noreferrer nofollow"`: the opened page gets no handle back to
  the workspace, and no referrer is sent.
- `referrerPolicy="no-referrer"`.

## Files

- `apps/webapp/app/verification/review/page.tsx`: route
- `apps/webapp/components/verification/VerificationReviewWorkspace.tsx`: workspace UI
- `apps/webapp/components/verification/EvidenceText.tsx`: safe evidence rendering
- `apps/webapp/hooks/useVerificationQueue.ts`: loading, polling, applying decisions
- `apps/webapp/lib/verification-request-service.ts`: API client and transition rules
- `apps/webapp/lib/evidence-links.ts`: URL extraction and validation
