import { apiClient, ApiResponse } from './api-client';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type WeightMode = 'REPUTATION' | 'TOKEN_BALANCE' | 'FLAT';

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
};

export function statusColor(status: VerificationStatus): string {
  switch (status) {
    case 'VERIFIED': return '#10b981';
    case 'REJECTED': return '#ef4444';
    default: return '#f59e0b';
  }
}

export function statusLabel(status: VerificationStatus): string {
  switch (status) {
    case 'VERIFIED': return 'Lumenpulse Verified';
    case 'REJECTED': return 'Not Verified';
    default: return 'Pending Review';
  }
}
