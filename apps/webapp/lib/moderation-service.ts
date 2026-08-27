// Client for submitting user reports to the moderation queue.
//
// Shape is kept in lockstep with the backend contract in
// apps/backend/src/moderation (CreateReportDto / ContentReport entity) so the
// UI is ready to talk to the real endpoint with no translation layer:
//   POST {API_BASE}/moderation/report
//   body: { targetType, targetId, reason, description? }
//   -> 201 ContentReport | 400 (duplicate/validation) | 401 (unauthenticated)

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

/** Mirrors backend `ReportType`. "other" is used for surfaces (e.g. news) that
 *  don't have a dedicated target type yet. */
export type ReportTargetType = "project" | "comment" | "user" | "other";

/** Mirrors backend `ReportReason`. */
export type ReportReason =
  | "spam"
  | "inappropriate_content"
  | "fraud"
  | "misleading_info"
  | "copyright_violation"
  | "other";

/** Mirrors backend `ReportStatus`. */
export type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";

export const REPORT_REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "fraud", label: "Fraud or scam" },
  { value: "misleading_info", label: "Misleading information" },
  { value: "copyright_violation", label: "Copyright violation" },
  { value: "other", label: "Other" },
];

export const REPORT_DESCRIPTION_MAX_LENGTH = 1000;

export interface SubmitReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description?: string;
}

export interface ContentReport {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  description?: string;
  status: ReportStatus;
  createdAt: string;
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof document === "undefined") return headers;

  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("auth-token="));
  const token = match?.split("=")[1];
  if (token) headers.Authorization = `Bearer ${token}`;

  return headers;
}

export class ModerationApiService {
  static async submitReport(input: SubmitReportInput): Promise<ContentReport> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/moderation/report`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(input),
      });
    } catch (err) {
      console.error("Error submitting report:", err);
      throw new Error("Network error. Check your connection and try again.");
    }

    if (response.status === 401) {
      throw new Error("Please log in to submit a report.");
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || "Failed to submit report. Please try again.");
    }

    return response.json();
  }
}
