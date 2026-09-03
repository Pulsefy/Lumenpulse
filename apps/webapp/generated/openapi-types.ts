export interface components {
  schemas: {
    WatchlistItemType: "asset" | "project";
    AddToWatchlistDto: {
      symbol: string;
      name?: unknown;
      type: WatchlistItemType;
      assetIssuer?: unknown;
      imageUrl?: unknown;
      notes?: unknown;
      sortOrder?: unknown;
    };
    UpdateWatchlistDto: {
      name?: unknown;
      imageUrl?: unknown;
      notes?: unknown;
      sortOrder?: unknown;
    };
    WatchlistItemResponseDto: {
      id: string;
      userId: string;
      symbol: string;
      name: unknown;
      type: WatchlistItemType;
      assetIssuer: unknown;
      imageUrl: unknown;
      notes: unknown;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    };
    WatchlistResponseDto: {
      items: WatchlistItemResponseDto[];
      total: number;
    };
    ReportType: "project" | "comment" | "user" | "other";
    ReportReason: "spam" | "inappropriate_content" | "fraud" | "misleading_info" | "copyright_violation" | "other";
    ReportStatus: "pending" | "under_review" | "resolved" | "dismissed";
    CreateReportDto: {
      targetType: ReportType;
      targetId: string;
      reason: ReportReason;
      description?: unknown;
    };
    ContentReport: {
      id: string;
      targetType: ReportType;
      targetId: string;
      reason: ReportReason;
      description?: unknown;
      status: ReportStatus;
      createdAt: string;
    };
    FeedActivityType: "contributor_registered" | "grant_contribution" | "reputation_change";
    FeedActivityItemDto: {
      id: string;
      activityType: FeedActivityType;
      contributorAddress: string;
      githubHandle?: unknown;
      timestamp: string;
      summary: string;
      metadata?: Record<string, unknown>;
    };
    ContributorFeedResponseDto: {
      items: FeedActivityItemDto[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      isSparseContributor: boolean;
    };
    AssetBalanceWithCurrency: {
      assetCode: string;
      assetIssuer: unknown;
      amount: string;
      value: number;
      valueUsd: number;
    };
    PortfolioSummaryResponseDto: {
      totalValue: string;
      currency: string;
      totalValueUsd: string;
      assets: AssetBalanceWithCurrency[];
      lastUpdated: unknown;
      hasLinkedAccount: boolean;
      exchangeRate: number;
    };
  };
}
