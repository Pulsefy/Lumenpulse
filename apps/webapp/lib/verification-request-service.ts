// Client for the reviewer side of /verification-requests, plus the on-chain
// registry tally (/verification/projects/:id) used as a request's vote state.
//
// Shapes mirror apps/backend/src/verification-requests/dto/verification-request.dto.ts
// and the transition table in verification-requests.service.ts.

import { getAuthToken } from "@/lib/auth-role";
import { clientConfig } from "@/lib/config";

const API_BASE = clientConfig.apiUrl;

export type VerificationRequestTargetType = "CONTRIBUTOR" | "PROJECT";

export type VerificationRequestStatus =
  | "SUBMITTED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface VerificationRequest {
  id: string;
  targetType: VerificationRequestTargetType;
  targetId: string;
  requesterId: string;
  status: VerificationRequestStatus;
  /** Free text; may contain links supporting the request. */
  evidence: string;
  requesterNote?: string | null;
  reviewerId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationDecision {
  status: VerificationRequestStatus;
  reviewNote?: string;
}

/** Registry tally for a PROJECT target, from GET /verification/projects/:id. */
export interface ProjectVoteState {
  projectId: number;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "ARCHIVED";
  votesFor: number;
  votesAgainst: number;
  quorumProgress: number;
}

/** Transitions a reviewer may make, as enforced by the backend service. */
export const REVIEWER_TRANSITIONS: Record<VerificationRequestStatus, VerificationRequestStatus[]> = {
  SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "REJECTED"],
  CHANGES_REQUESTED: ["IN_REVIEW"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Statuses still waiting on a reviewer. */
export const OPEN_STATUSES: readonly VerificationRequestStatus[] = [
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
];

/** Decisions that close or bounce a request and so must carry a rationale. */
export function requiresRationale(status: VerificationRequestStatus): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "CHANGES_REQUESTED";
}

export const REVIEW_NOTE_MAX_LENGTH = 4000;

export class VerificationRequestApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "VerificationRequestApiError";
  }
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function toError(response: Response, fallback: string): Promise<VerificationRequestApiError> {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown };
  const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
  return new VerificationRequestApiError(
    typeof message === "string" && message ? message : `${fallback} (${response.status})`,
    response.status,
  );
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class VerificationRequestApiService {
  /** GET /verification-requests (reviewer/admin only), oldest first. */
  static async list(status?: VerificationRequestStatus): Promise<VerificationRequest[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const response = await fetch(`${API_BASE}/verification-requests${qs}`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw await toError(response, "Failed to load verification requests");
    const data = (await response.json().catch(() => null)) as unknown;
    return Array.isArray(data) ? (data as VerificationRequest[]) : [];
  }

  /**
   * PATCH /verification-requests/:id/status. The body carries only the
   * whitelisted fields; the idempotency key makes a retried submit safe.
   */
  static async decide(
    id: string,
    decision: VerificationDecision,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<VerificationRequest> {
    const reviewNote = decision.reviewNote?.trim();
    const response = await fetch(
      `${API_BASE}/verification-requests/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          status: decision.status,
          ...(reviewNote ? { reviewNote } : {}),
        }),
      },
    );
    if (!response.ok) throw await toError(response, "Failed to record decision");
    return (await response.json()) as VerificationRequest;
  }

  /**
   * Community vote tally for a PROJECT target. Returns null when the target
   * is not a registered on-chain project (non-numeric id, or 404).
   */
  static async getProjectVoteState(targetId: string): Promise<ProjectVoteState | null> {
    if (!/^\d+$/.test(targetId)) return null;
    const response = await fetch(`${API_BASE}/verification/projects/${targetId}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await toError(response, "Failed to load vote state");
    return (await response.json()) as ProjectVoteState;
  }
}
