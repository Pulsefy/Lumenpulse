import { apiClient, ApiResponse } from './api-client';

/**
 * Types of content that can be reported
 */
export enum ReportType {
  PROJECT = 'project',
  COMMENT = 'comment',
  USER = 'user',
  OTHER = 'other',
}

/**
 * Reasons for reporting content
 */
export enum ReportReason {
  SPAM = 'spam',
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  FRAUD = 'fraud',
  MISLEADING_INFO = 'misleading_info',
  COPYRIGHT_VIOLATION = 'copyright_violation',
  OTHER = 'other',
}

/**
 * Status of a content report
 */
export enum ReportStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

/**
 * Content report data structure
 */
export interface ContentReport {
  id: string;
  targetType: ReportType;
  targetId: string;
  reason: ReportReason;
  description?: string;
  status: ReportStatus;
  reporterId: string;
  reviewerId?: string;
  reviewNotes?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload for creating a new report
 */
export interface CreateReportPayload {
  targetType: ReportType;
  targetId: string;
  reason: ReportReason;
  description?: string;
}

/**
 * Moderation / Reporting API Service
 */
export const moderationApi = {
  /**
   * Submit a content report
   */
  async createReport(payload: CreateReportPayload): Promise<ApiResponse<ContentReport>> {
    return apiClient.post<ContentReport>('/moderation/report', payload);
  },

  /**
   * Get reports submitted by the current user
   */
  async getMyReports(
    page = 1,
    limit = 20,
  ): Promise<
    ApiResponse<{
      reports: ContentReport[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>
  > {
    return apiClient.get(`/moderation/my-reports?page=${page}&limit=${limit}`);
  },

  /**
   * Get moderation queue (Admin only)
   */
  async getModerationQueue(filters?: {
    status?: ReportStatus;
    targetType?: ReportType;
    targetId?: string;
    page?: number;
    limit?: number;
  }): Promise<
    ApiResponse<{
      reports: ContentReport[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>
  > {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.targetType) params.append('targetType', filters.targetType);
    if (filters?.targetId) params.append('targetId', filters.targetId);
    if (filters?.page) params.append('page', String(filters.page));
    if (filters?.limit) params.append('limit', String(filters.limit));

    return apiClient.get(`/moderation/queue?${params.toString()}`);
  },

  /**
   * Get moderation statistics (Admin only)
   */
  async getModerationStats(): Promise<
    ApiResponse<{
      totalReports: number;
      pendingReports: number;
      underReviewReports: number;
      resolvedReports: number;
      dismissedReports: number;
    }>
  > {
    return apiClient.get('/moderation/queue/stats');
  },

  /**
   * Update report status (Admin only)
   */
  async updateReport(
    reportId: string,
    updates: {
      status?: ReportStatus;
      reviewNotes?: string;
    },
  ): Promise<ApiResponse<ContentReport>> {
    return apiClient.patch<ContentReport>(`/moderation/queue/${reportId}`, updates);
  },
};
