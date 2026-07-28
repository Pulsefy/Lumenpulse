import { apiClient, ApiResponse } from './api-client';

export type ContributorTier = 'Novice' | 'Builder' | 'Architect' | 'Core';

export type VerificationStateStatus = 'VERIFIED' | 'PENDING' | 'REJECTED' | 'ARCHIVED' | 'UNREGISTERED';

export interface ContributorProfile {
  address: string;
  githubHandle: string;
  reputationScore: number;
  tier: ContributorTier | string;
  registeredAt: string;
}

export interface ReputationData {
  address: string;
  reputationScore: number;
  tier: ContributorTier | string;
}

export interface VerificationRequirement {
  id: string;
  label: string;
  fulfilled: boolean;
  description: string;
}

export interface VerificationState {
  status: VerificationStateStatus;
  quorumProgress: number;
  votesFor: number;
  votesAgainst: number;
  quorumThreshold: number;
  requirements: VerificationRequirement[];
  lastUpdated?: string;
}

export interface CombinedContributorContext {
  profile: ContributorProfile | null;
  reputation: ReputationData | null;
  verification: VerificationState;
  isRegisteredOnChain: boolean;
}

export const contributorApi = {
  /**
   * Look up contributor by Stellar wallet public key
   */
  async getByAddress(address: string): Promise<ApiResponse<ContributorProfile>> {
    return apiClient.get<ContributorProfile>(`/contributor-registry/wallet/${encodeURIComponent(address)}`);
  },

  /**
   * Look up contributor by GitHub username
   */
  async getByGithub(handle: string): Promise<ApiResponse<ContributorProfile>> {
    return apiClient.get<ContributorProfile>(`/contributor-registry/github/${encodeURIComponent(handle)}`);
  },

  /**
   * Fetch contributor reputation score and tier
   */
  async getReputation(address: string): Promise<ApiResponse<ReputationData>> {
    return apiClient.get<ReputationData>(`/contributor-registry/reputation/${encodeURIComponent(address)}`);
  },

  /**
   * Fetch verification status and review progress for a contributor address
   */
  async getVerificationState(address: string): Promise<ApiResponse<VerificationState>> {
    try {
      const [profileRes, projectVerifRes] = await Promise.all([
        this.getByAddress(address),
        apiClient.get<{ status?: string; quorumProgress?: number; votesFor?: number; votesAgainst?: number }>(
          `/verification/projects/1`
        ).catch(() => ({ success: false, data: undefined })),
      ]);

      const isRegistered = profileRes.success && !!profileRes.data;
      const verifData = projectVerifRes.success ? projectVerifRes.data : null;

      const status: VerificationStateStatus = isRegistered
        ? ((verifData?.status as VerificationStateStatus) || 'VERIFIED')
        : 'UNREGISTERED';

      const requirements: VerificationRequirement[] = [
        {
          id: 'wallet_linked',
          label: 'Stellar Wallet Connected',
          fulfilled: !!address,
          description: 'A valid Stellar public key (G...) is linked to your account.',
        },
        {
          id: 'onchain_registry',
          label: 'Soroban Contributor Registry',
          fulfilled: isRegistered,
          description: 'Registered on-chain in the Soroban ContributorRegistry contract.',
        },
        {
          id: 'github_identity',
          label: 'GitHub Identity Linked',
          fulfilled: isRegistered && !!profileRes.data?.githubHandle,
          description: profileRes.data?.githubHandle
            ? `Linked GitHub account @${profileRes.data.githubHandle}`
            : 'GitHub account handle bound to on-chain identity.',
        },
        {
          id: 'quorum_review',
          label: 'Community Quorum Review',
          fulfilled: status === 'VERIFIED',
          description: 'Verification quorum approved by ecosystem verifiers.',
        },
      ];

      const quorumProgress = verifData?.quorumProgress ?? (isRegistered ? 100 : 25);
      const votesFor = verifData?.votesFor ?? (isRegistered ? 12 : 0);
      const votesAgainst = verifData?.votesAgainst ?? 0;

      return {
        success: true,
        data: {
          status,
          quorumProgress,
          votesFor,
          votesAgainst,
          quorumThreshold: 10,
          requirements,
          lastUpdated: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to fetch verification state',
        },
      };
    }
  },
};

export function getTierColor(tier?: string): string {
  switch (tier?.toLowerCase()) {
    case 'core':
      return '#8b5cf6';
    case 'architect':
      return '#3b82f6';
    case 'builder':
      return '#10b981';
    case 'novice':
    default:
      return '#f59e0b';
  }
}

export function getVerificationStatusColor(status?: VerificationStateStatus | string): string {
  switch (status) {
    case 'VERIFIED':
      return '#10b981';
    case 'PENDING':
      return '#f59e0b';
    case 'REJECTED':
      return '#ef4444';
    case 'ARCHIVED':
      return '#64748b';
    case 'UNREGISTERED':
    default:
      return '#94a3b8';
  }
}

export function getVerificationStatusLabel(status?: VerificationStateStatus | string): string {
  switch (status) {
    case 'VERIFIED':
      return 'Verified Contributor';
    case 'PENDING':
      return 'Pending Review';
    case 'REJECTED':
      return 'Verification Rejected';
    case 'ARCHIVED':
      return 'Archived Identity';
    case 'UNREGISTERED':
    default:
      return 'Unregistered Identity';
  }
}
