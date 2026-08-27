export type SubmissionStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PUBLISHED";

export interface ProjectSubmission {
  projectId: number;
  creatorPublicKey: string;
  title: string;
  content: string;
  status: SubmissionStatus;
  reviewerId?: string;
  reviewNote?: string;
  updatedAt: number;
}

export interface SubmissionActionPayload {
  actorId: string;
  note?: string;
}

export interface DecisionEntry {
  action: "request_changes" | "approve" | "publish" | "reject";
  actorId: string;
  note?: string;
  timestamp: number;
}
