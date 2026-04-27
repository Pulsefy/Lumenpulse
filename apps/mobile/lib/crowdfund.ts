import { apiClient, ApiResponse } from './api-client';

/**
 * Crowdfund Project — mirrors the on-chain ProjectData structure
 */
export interface CrowdfundProject {
  id: number;
  owner: string;
  name: string;
  description?: string;
  bannerUrl?: string;
  targetAmount: string;
  tokenAddress: string;
  totalDeposited: string;
  totalWithdrawn: string;
  isActive: boolean;
  contributorCount: number;
  roadmap?: RoadmapItem[];
  createdAt?: string;
}

/**
 * Roadmap milestone item
 */
export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  isCompleted: boolean;
}

/**
 * Contributor information
 */
export interface Contributor {
  publicKey: string;
  totalContributed: string;
  contributionCount: number;
  lastContributionAt: string;
}

/**
 * Payload the mobile client sends when contributing to a vault
 */
export interface ContributionRequest {
  projectId: number;
  amount: string;
  senderPublicKey: string;
}

/**
 * Response returned after a contribution is submitted
 */
export interface ContributionResponse {
  transactionHash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  ledger?: number;
  message?: string;
}

/**
 * Lightweight record of a single contribution
 */
export interface ContributionRecord {
  projectId: number;
  contributor: string;
  amount: string;
  timestamp: string;
  transactionHash: string;
}

/**
 * Crowdfund / Vault API Service
 *
 * All on-chain transaction building and signing is delegated to the backend
 * proxy so the mobile app does not need to bundle the Stellar SDK or manage
 * secret keys directly.
 */
export const crowdfundApi = {
  /**
   * Fetch the list of active crowdfund projects
   */
  async listProjects(): Promise<ApiResponse<CrowdfundProject[]>> {
    return apiClient.get<CrowdfundProject[]>('/crowdfund/projects');
  },

  /**
   * Fetch a single project by its on-chain ID
   */
  async getProject(projectId: number): Promise<ApiResponse<CrowdfundProject>> {
    return apiClient.get<CrowdfundProject>(`/crowdfund/projects/${projectId}`);
  },

  /**
   * Submit a contribution to a project vault.
   *
   * The backend builds the Soroban `deposit` invocation, signs it
   * (or returns an unsigned XDR for the wallet to sign), and submits
   * the transaction to the network.
   */
  async contribute(payload: ContributionRequest): Promise<ApiResponse<ContributionResponse>> {
    return apiClient.post<ContributionResponse>('/crowdfund/contribute', payload);
  },

  /**
   * Fetch the authenticated user's contribution history for a project
   */
  async getMyContributions(projectId: number): Promise<ApiResponse<ContributionRecord[]>> {
    return apiClient.get<ContributionRecord[]>(`/crowdfund/projects/${projectId}/my-contributions`);
  },

  /**
   * Fetch the current on-chain balance for a project vault
   */
  async getProjectBalance(projectId: number): Promise<ApiResponse<{ balance: string }>> {
    return apiClient.get<{ balance: string }>(`/crowdfund/projects/${projectId}/balance`);
  },

  /**
   * Fetch recent contributors for a project
   */
  async getContributors(projectId: number): Promise<ApiResponse<Contributor[]>> {
    return apiClient.get<Contributor[]>(`/crowdfund/projects/${projectId}/contributors`);
  },
};
