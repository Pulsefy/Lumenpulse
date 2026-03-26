import { apiClient, ApiResponse } from './api-client';

/**
 * Auth API Types
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  createdAt: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

/**
 * Portfolio API Types
 */
export interface AssetBalance {
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  valueUsd: number;
}

export interface PortfolioSummary {
  totalValueUsd: string;
  assets: AssetBalance[];
  lastUpdated: string | null;
  hasLinkedAccount: boolean;
}

export interface SnapshotResponse {
  success: boolean;
  snapshot: {
    id: string;
    createdAt: string;
    totalValueUsd: string;
  };
}

export interface NotificationPreferences {
  priceAlerts: boolean;
  newsAlerts: boolean;
  securityAlerts: boolean;
}

export interface UserPreferences {
  notifications: NotificationPreferences;
}

export interface UserProfileResponse {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  stellarPublicKey?: string;
  preferences?: UserPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedStellarAccount {
  id: string;
  publicKey: string;
  label?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkStellarAccountPayload {
  publicKey: string;
  label?: string;
}

export interface UpdateProfilePayload {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  preferences?: {
    notifications?: Partial<NotificationPreferences>;
  };
}

/**
 * Auth API Service
 * Uses the shared API client for all requests
 */
export const authApi = {
  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<ApiResponse<LoginResponse>> {
    return apiClient.post<LoginResponse>('/auth/login', credentials);
  },

  /**
   * Register new user
   */
  async register(credentials: RegisterCredentials): Promise<ApiResponse<RegisterResponse>> {
    return apiClient.post<RegisterResponse>('/auth/register', credentials);
  },
};

/**
 * Health Check API
 */
export const healthApi = {
  /**
   * Check backend health
   */
  async check(): Promise<ApiResponse<HealthResponse>> {
    return apiClient.get<HealthResponse>('/health');
  },
};

/**
 * Portfolio API Service
 */
export const portfolioApi = {
  /**
   * Get latest portfolio summary (total USD + asset list)
   */
  async getSummary(): Promise<ApiResponse<PortfolioSummary>> {
    return apiClient.get<PortfolioSummary>('/portfolio/summary');
  },

  /**
   * Trigger a fresh snapshot for the authenticated user
   * Used by pull-to-refresh to get live Stellar balances
   */
  async createSnapshot(): Promise<ApiResponse<SnapshotResponse>> {
    return apiClient.post<SnapshotResponse>('/portfolio/snapshot');
  },
};

/**
 * User/Profile API Service
 */
export const usersApi = {
  async getProfile(): Promise<ApiResponse<UserProfileResponse>> {
    return apiClient.get<UserProfileResponse>('/users/me');
  },

  async updateProfile(payload: UpdateProfilePayload): Promise<ApiResponse<UserProfileResponse>> {
    return apiClient.patch<UserProfileResponse>('/users/me', payload);
  },

  async getLinkedAccounts(): Promise<ApiResponse<LinkedStellarAccount[]>> {
    return apiClient.get<LinkedStellarAccount[]>('/users/me/accounts');
  },

  async linkStellarAccount(
    payload: LinkStellarAccountPayload,
  ): Promise<ApiResponse<LinkedStellarAccount>> {
    return apiClient.post<LinkedStellarAccount>('/users/me/accounts', payload);
  },

  async removeLinkedAccount(accountId: string): Promise<ApiResponse<void>> {
    return apiClient.delete<void>(`/users/me/accounts/${accountId}`);
  },
};

/**
 * Stellar Asset Discovery Types
 */
export interface StellarAsset {
  code: string;
  name: string;
  issuer: string | null;
  priceUsd: number;
  change24h: number; // percentage, e.g. 2.5 or -1.3
  iconUrl?: string | null;
}

export interface StellarAssetsResponse {
  assets: StellarAsset[];
}

/**
 * Stellar Asset Discovery API Service
 */
export const stellarApi = {
  /**
   * Fetch a list of popular/discoverable Stellar assets with price data.
   * Maps to GET /stellar/assets on the backend.
   */
  async getAssets(): Promise<ApiResponse<StellarAssetsResponse>> {
    return apiClient.get<StellarAssetsResponse>('/stellar/assets');
  },
};

// Re-export the client for direct use if needed
export { apiClient };
