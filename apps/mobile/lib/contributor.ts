import { apiClient, ApiResponse } from './api-client';

export type ContributorTier = 'Novice' | 'Builder' | 'Architect' | 'Core';

export type VerificationStateStatus =
  | 'VERIFIED'
  | 'PENDING'
  | 'REJECTED'
  | 'ARCHIVED'
  | 'UNREGISTERED';

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

/** A single requirement in the contributor registry checklist. */
export interface RegistryRequirement {
  id: string;
  label: string;
  fulfilled: boolean;
  description: string;
}

/** One reputation tier band, with the score needed to reach it. */
export interface ReputationTierBand {
  tier: ContributorTier;
  minScore: number;
  achieved: boolean;
}

/**
 * Score thresholds per tier.
 *
 * These MUST stay in sync with the backend `ContributorRegistryService.tierFromScore`
 * (`apps/backend/src/contributor-registry/contributor-registry.service.ts`) and the
 * `ContributorRegistry` contract, otherwise the app and the server would disagree
 * about a contributor's tier.
 */
export const REPUTATION_TIERS: readonly { tier: ContributorTier; minScore: number }[] = [
  { tier: 'Novice', minScore: 0 },
  { tier: 'Builder', minScore: 10 },
  { tier: 'Architect', minScore: 50 },
  { tier: 'Core', minScore: 100 },
];

/**
 * Signals the registry folds into a reputation score. Exported so the profile
 * screen can explain the number rather than only rendering it.
 */
export interface ReputationFactor {
  id: string;
  label: string;
  description: string;
  direction: 'increase' | 'decrease';
}

export const REPUTATION_FACTORS: readonly ReputationFactor[] = [
  {
    id: 'contributions',
    label: 'Verified contributions',
    description: 'Each contribution recorded against your on-chain identity adds points.',
    direction: 'increase',
  },
  {
    id: 'reviews',
    label: 'Community review approvals',
    description: 'Reputation updates approved by ecosystem reviewers raise your score.',
    direction: 'increase',
  },
  {
    id: 'penalties',
    label: 'Resolved dispute penalties',
    description: 'A dispute resolved against you deducts points, floored at zero.',
    direction: 'decrease',
  },
];

/**
 * Everything the profile needs to explain a reputation score: the derived
 * tier, how far the contributor is from the next band, and what moves the
 * number.
 */
export interface ReputationBreakdown {
  score: number;
  tier: ContributorTier;
  /** Next tier reachable from `score`, or null when already at the top tier. */
  nextTier: ContributorTier | null;
  /** Points still required for `nextTier`; 0 at the top tier. */
  pointsToNextTier: number;
  /** Progress from the current tier floor towards `nextTier`, 0-100. */
  progressToNextTier: number;
  bands: ReputationTierBand[];
  factors: readonly ReputationFactor[];
}

/**
 * Registration + identity state for one wallet, derived from the on-chain
 * contributor registry rather than from project verification.
 */
export interface ContributorRegistryState {
  status: VerificationStateStatus;
  isRegistered: boolean;
  githubHandle: string | null;
  /** True when the on-chain record has a GitHub handle bound to it. */
  isGithubLinked: boolean;
  registeredAt: string | null;
  reputation: ReputationBreakdown;
  requirements: RegistryRequirement[];
  lastUpdated: string;
}

export interface CombinedContributorContext {
  profile: ContributorProfile | null;
  reputation: ReputationData | null;
  registry: ContributorRegistryState;
  isRegisteredOnChain: boolean;
}

/** Current registration nonce for an address (the replay guard signed over). */
export interface RegistrationNonce {
  address: string;
  nonce: number;
}

/** Result of a successful registry submission. */
export interface RegistrationSubmission {
  transactionHash: string;
  status: string;
  ledger?: number;
}

/** Unsigned registration transaction, ready to be signed by the wallet. */
export interface UnsignedRegistration {
  unsignedXdr: string;
  networkPassphrase: string;
}

/**
 * Payload for the gasless `register-with-sig` endpoint. The off-chain
 * `SorobanAuthorizationEntry` is the cryptographic proof; `signatureHex` is an
 * optional caller-visible artifact.
 */
export interface RegisterContributorRequest {
  address: string;
  githubHandle: string;
  signedAuthEntryXdr: string;
  signatureHex?: string;
}

export const contributorApi = {
  /**
   * Look up contributor by Stellar wallet public key
   */
  async getByAddress(address: string): Promise<ApiResponse<ContributorProfile>> {
    return apiClient.get<ContributorProfile>(
      `/contributor-registry/wallet/${encodeURIComponent(address)}`,
    );
  },

  /**
   * Look up contributor by GitHub username
   */
  async getByGithub(handle: string): Promise<ApiResponse<ContributorProfile>> {
    return apiClient.get<ContributorProfile>(
      `/contributor-registry/github/${encodeURIComponent(handle)}`,
    );
  },

  /**
   * Fetch contributor reputation score and tier
   */
  async getReputation(address: string): Promise<ApiResponse<ReputationData>> {
    return apiClient.get<ReputationData>(
      `/contributor-registry/reputation/${encodeURIComponent(address)}`,
    );
  },

  /**
   * Read the current registration nonce for an address.
   *
   * The nonce is part of the `register_contributor_with_sig` authorization
   * scope and is advanced by the contract after every signed registration
   * attempt, so it must always be fetched immediately before signing.
   */
  async getNonce(address: string): Promise<ApiResponse<RegistrationNonce>> {
    return apiClient.get<RegistrationNonce>(
      `/contributor-registry/nonce/${encodeURIComponent(address)}`,
    );
  },

  /**
   * Build the unsigned registration transaction for a wallet to sign.
   */
  async buildRegistration(payload: {
    address: string;
    githubHandle: string;
  }): Promise<ApiResponse<UnsignedRegistration>> {
    return apiClient.post<UnsignedRegistration>('/contributor-registry/register', payload);
  },

  /**
   * Submit a gasless registration carrying the contributor's off-chain signature.
   */
  async submitRegistration(
    payload: RegisterContributorRequest,
  ): Promise<ApiResponse<RegistrationSubmission>> {
    return apiClient.post<RegistrationSubmission>(
      '/contributor-registry/register-with-sig',
      payload,
    );
  },

  /**
   * Read the registry + reputation state for an address.
   *
   * A `404` on the wallet lookup is a meaningful answer ("this wallet is not
   * registered") and resolves to `success: true` with `isRegistered: false`.
   * Every other failure (network, 5xx) is surfaced as an error so the screen
   * never mislabels an unreachable registry as an unregistered wallet.
   */
  async getRegistryState(address: string): Promise<ApiResponse<ContributorRegistryState>> {
    const [profileRes, reputationRes] = await Promise.all([
      this.getByAddress(address),
      this.getReputation(address),
    ]);

    const profileNotFound = !profileRes.success && profileRes.error?.statusCode === 404;
    if (!profileRes.success && !profileNotFound) {
      return {
        success: false,
        error: profileRes.error ?? { message: 'Failed to read the contributor registry' },
      };
    }

    const profile = profileRes.success ? (profileRes.data ?? null) : null;
    const reputation = reputationRes.success ? (reputationRes.data ?? null) : null;

    return { success: true, data: buildRegistryState(address, profile, reputation) };
  },
};

/**
 * Map a reputation score to its tier.
 *
 * Mirrors the backend's `tierFromScore` so the client never derives a
 * different tier than the server reports.
 */
export function tierFromScore(score: number): ContributorTier {
  const safeScore = Number.isFinite(score) ? score : 0;
  let tier: ContributorTier = 'Novice';
  for (const band of REPUTATION_TIERS) {
    if (safeScore >= band.minScore) tier = band.tier;
  }
  return tier;
}

/**
 * Explain a raw score: tier, distance to the next band, progress within the
 * current band, the band table, and the factors that move the number.
 */
export function buildReputationBreakdown(score: number): ReputationBreakdown {
  const safeScore = Math.max(0, Number.isFinite(score) ? score : 0);

  let bandIndex = 0;
  REPUTATION_TIERS.forEach((band, index) => {
    if (safeScore >= band.minScore) bandIndex = index;
  });

  const current = REPUTATION_TIERS[bandIndex];
  const next = REPUTATION_TIERS[bandIndex + 1] ?? null;

  const span = next ? next.minScore - current.minScore : 0;
  const earned = safeScore - current.minScore;
  const progressToNextTier = next
    ? Math.min(100, Math.max(0, Math.round((earned / span) * 100)))
    : 100;

  return {
    score: safeScore,
    tier: current.tier,
    nextTier: next ? next.tier : null,
    pointsToNextTier: next ? Math.max(0, next.minScore - safeScore) : 0,
    progressToNextTier,
    bands: REPUTATION_TIERS.map((band) => ({
      tier: band.tier,
      minScore: band.minScore,
      achieved: safeScore >= band.minScore,
    })),
    factors: REPUTATION_FACTORS,
  };
}

/**
 * Build the full registry state for a wallet from its registry records.
 *
 * Pure so it can be unit tested without a network, and so the screen has a
 * single, typed source of truth for "registered or not".
 */
export function buildRegistryState(
  address: string | null,
  profile: ContributorProfile | null,
  reputation: ReputationData | null,
): ContributorRegistryState {
  const isRegistered = !!profile;
  const githubHandle = profile?.githubHandle?.trim() ? profile.githubHandle.trim() : null;
  const isGithubLinked = isRegistered && !!githubHandle;

  const score = reputation?.reputationScore ?? profile?.reputationScore ?? 0;
  const breakdown = buildReputationBreakdown(score);
  const builderTier = REPUTATION_TIERS[1];

  const requirements: RegistryRequirement[] = [
    {
      id: 'wallet_linked',
      label: 'Stellar wallet connected',
      fulfilled: !!address,
      description: 'A valid Stellar public key (G...) is linked to this account.',
    },
    {
      id: 'onchain_registry',
      label: 'Registered on the Soroban contributor registry',
      fulfilled: isRegistered,
      description: isRegistered
        ? 'An on-chain ContributorRegistry entry exists for this wallet.'
        : 'No on-chain ContributorRegistry entry exists for this wallet yet.',
    },
    {
      id: 'github_identity',
      label: 'GitHub handle linked',
      fulfilled: isGithubLinked,
      description: isGithubLinked
        ? `Handle @${githubHandle} is bound to this on-chain identity.`
        : 'No GitHub handle is bound to this on-chain identity yet.',
    },
    {
      id: 'reputation_established',
      label: `Reputation tier ${builderTier.tier} or higher`,
      fulfilled: isRegistered && score >= builderTier.minScore,
      description: 'Contributors reach the Builder tier at 10 reputation points.',
    },
  ];

  return {
    status: isRegistered ? 'VERIFIED' : 'UNREGISTERED',
    isRegistered,
    githubHandle,
    isGithubLinked,
    registeredAt: profile?.registeredAt ?? null,
    reputation: breakdown,
    requirements,
    lastUpdated: new Date().toISOString(),
  };
}

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
