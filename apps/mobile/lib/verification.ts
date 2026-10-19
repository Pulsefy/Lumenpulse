import { apiClient, ApiResponse } from './api-client';
import { dataViz } from '../theme/tokens';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'ARCHIVED';
export type WeightMode = 'REPUTATION' | 'TOKEN_BALANCE' | 'FLAT';

export type VerificationRequestTargetType = 'CONTRIBUTOR' | 'PROJECT';

export type VerificationRequestStatus =
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export interface VerificationEvidenceAttachment {
  type: 'image' | 'file' | 'location';
  uri?: string;
  url?: string;
  name?: string;
  size?: number; // size in bytes
  mimeType?: string;
  latitude?: number;
  longitude?: number;
}

export interface CreateVerificationRequestPayload {
  targetType: VerificationRequestTargetType;
  targetId: string;
  evidence: string;
  requesterNote?: string;
  attachments?: VerificationEvidenceAttachment[];
}

export interface VerificationRequestItem {
  id: string;
  targetType: VerificationRequestTargetType;
  targetId: string;
  requesterId: string;
  status: VerificationRequestStatus;
  evidence: string;
  requesterNote?: string | null;
  reviewerId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationRequestDraft {
  targetType: VerificationRequestTargetType;
  targetId: string;
  note: string;
  attachments: VerificationEvidenceAttachment[];
  savedAt: string;
}

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

export function serializeEvidenceWithAttachments(
  text: string,
  attachments?: VerificationEvidenceAttachment[],
): string {
  const cleanText = (text || '').trim();
  if (!attachments || attachments.length === 0) {
    return cleanText;
  }

  const attachmentLines = attachments.map((att) => {
    if (att.type === 'location') {
      return `[Location: ${att.latitude?.toFixed(5)}, ${att.longitude?.toFixed(5)}]`;
    }
    const label = att.name || (att.type === 'image' ? 'Image evidence' : 'Document evidence');
    const target = att.url || att.uri || 'attached';
    return `[${label}](${target})`;
  });

  if (!cleanText) {
    return attachmentLines.join('\n');
  }

  return `${cleanText}\n\nEvidence Attachments:\n${attachmentLines.join('\n')}`;
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}

export interface UploadAttachmentOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  maxRetries?: number;
}

export async function uploadEvidenceAttachment(
  attachment: VerificationEvidenceAttachment,
  options: UploadAttachmentOptions = {},
): Promise<{ url: string; success: boolean; error?: string }> {
  // If already has an uploaded URL, return cleanly
  if (attachment.url) {
    return { url: attachment.url, success: true };
  }

  // Size limit validation
  if (attachment.size && attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      url: '',
      success: false,
      error: `File size exceeds the limit of ${Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))}MB`,
    };
  }

  const maxRetries = options.maxRetries ?? 2;
  let attempts = 0;

  while (attempts <= maxRetries) {
    if (options.signal?.aborted) {
      return { url: '', success: false, error: 'Upload cancelled' };
    }

    try {
      options.onProgress?.({
        bytesUploaded: 0,
        totalBytes: attachment.size || 100,
        percentage: 0,
      });

      // Simulate chunked upload or network transfer that respects signals
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 50);
        if (options.signal) {
          options.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject(new Error('Upload cancelled'));
            },
            { once: true },
          );
        }
      });

      options.onProgress?.({
        bytesUploaded: attachment.size || 100,
        totalBytes: attachment.size || 100,
        percentage: 100,
      });

      const simulatedUrl =
        attachment.uri &&
        (attachment.uri.startsWith('http://') || attachment.uri.startsWith('https://'))
          ? attachment.uri
          : `https://verification-evidence.lumenpulse.io/${Date.now()}-${encodeURIComponent(attachment.name || 'evidence')}`;

      return { url: simulatedUrl, success: true };
    } catch (err) {
      attempts++;
      if (options.signal?.aborted || attempts > maxRetries) {
        return {
          url: '',
          success: false,
          error: err instanceof Error ? err.message : 'Upload failed',
        };
      }
    }
  }

  return { url: '', success: false, error: 'Upload failed after retries' };
}

export interface ProjectVerification {
  projectId: number;
  name: string;
  ownerPublicKey: string;
  status: VerificationStatus;
  votesFor: number;
  votesAgainst: number;
  registeredAt: number;
  resolvedAt: number;
  quorumProgress: number;
}

export interface VoteResult {
  projectId: number;
  voterPublicKey: string;
  weight: number;
  support: boolean;
  newStatus: VerificationStatus;
  votesFor: number;
  votesAgainst: number;
}

export interface RegistryConfig {
  quorumThreshold: number;
  weightMode: WeightMode;
  minVoterWeight: number;
}

export const verificationApi = {
  getProject(projectId: number): Promise<ApiResponse<ProjectVerification>> {
    return apiClient.get<ProjectVerification>(`/verification/projects/${projectId}`);
  },

  listProjects(status?: VerificationStatus): Promise<ApiResponse<ProjectVerification[]>> {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get<ProjectVerification[]>(`/verification/projects${qs}`);
  },

  isVerified(projectId: number): Promise<ApiResponse<{ projectId: number; verified: boolean }>> {
    return apiClient.get(`/verification/projects/${projectId}/verified`);
  },

  castVote(
    projectId: number,
    voterPublicKey: string,
    support: boolean,
  ): Promise<ApiResponse<VoteResult>> {
    return apiClient.post<VoteResult>('/verification/vote', {
      projectId,
      voterPublicKey,
      support,
    });
  },

  getConfig(): Promise<ApiResponse<RegistryConfig>> {
    return apiClient.get<RegistryConfig>('/verification/config');
  },

  createVerificationRequest(
    payload: CreateVerificationRequestPayload,
  ): Promise<ApiResponse<VerificationRequestItem>> {
    const evidenceText = serializeEvidenceWithAttachments(payload.evidence, payload.attachments);

    return apiClient.post<VerificationRequestItem>('/verification-requests', {
      targetType: payload.targetType,
      targetId: payload.targetId,
      evidence: evidenceText,
      ...(payload.requesterNote ? { requesterNote: payload.requesterNote } : {}),
    });
  },

  getMyVerificationRequests(): Promise<ApiResponse<VerificationRequestItem[]>> {
    return apiClient.get<VerificationRequestItem[]>('/verification-requests/mine');
  },

  getVerificationRequest(id: string): Promise<ApiResponse<VerificationRequestItem>> {
    return apiClient.get<VerificationRequestItem>(`/verification-requests/${id}`);
  },

  cancelVerificationRequest(id: string): Promise<ApiResponse<VerificationRequestItem>> {
    return apiClient.post<VerificationRequestItem>(`/verification-requests/${id}/cancel`, {});
  },
};

export function statusColor(status: VerificationStatus): string {
  switch (status) {
    case 'VERIFIED':
      return dataViz.status.verified;
    case 'REJECTED':
      return dataViz.status.rejected;
    case 'ARCHIVED':
      return dataViz.status.archived;
    default:
      return dataViz.status.pending;
  }
}

export function statusLabel(status: VerificationStatus): string {
  switch (status) {
    case 'VERIFIED':
      return 'Lumenpulse Verified';
    case 'REJECTED':
      return 'Not Verified';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return 'Pending Review';
  }
}

export function requestStatusColor(status: VerificationRequestStatus): string {
  switch (status) {
    case 'APPROVED':
      return '#10b981';
    case 'REJECTED':
      return '#ef4444';
    case 'CHANGES_REQUESTED':
      return '#f97316';
    case 'IN_REVIEW':
      return '#3b82f6';
    case 'CANCELLED':
      return '#64748b';
    case 'SUBMITTED':
    default:
      return '#f59e0b';
  }
}

export function requestStatusLabel(status: VerificationRequestStatus): string {
  switch (status) {
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    case 'CHANGES_REQUESTED':
      return 'Changes Requested';
    case 'IN_REVIEW':
      return 'In Review';
    case 'CANCELLED':
      return 'Cancelled';
    case 'SUBMITTED':
    default:
      return 'Submitted';
  }
}
