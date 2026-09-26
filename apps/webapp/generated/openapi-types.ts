export interface components {
  schemas: {
    WatchlistItemType: "asset" | "project";
    AddToWatchlistDto: {
      symbol: string;
      name?: string;
      type: components['schemas']['WatchlistItemType'];
      assetIssuer?: string;
      imageUrl?: string;
      notes?: string;
      sortOrder?: number;
    };
    UpdateWatchlistDto: {
      name?: string;
      imageUrl?: string;
      notes?: string;
      sortOrder?: number;
    };
    WatchlistItemResponseDto: {
      id: string;
      userId: string;
      symbol: string;
      name?: string | null;
      type: components['schemas']['WatchlistItemType'];
      assetIssuer?: string | null;
      imageUrl?: string | null;
      notes?: string | null;
      sortOrder: number;
      createdAt: string;
      updatedAt: string;
    };
    WatchlistResponseDto: {
      items: components['schemas']['WatchlistItemResponseDto'][];
      total: number;
    };
    ReportType: "project" | "comment" | "user" | "other";
    ReportReason: "spam" | "inappropriate_content" | "fraud" | "misleading_info" | "copyright_violation" | "other";
    ReportStatus: "pending" | "under_review" | "resolved" | "dismissed";
    CreateReportDto: {
      targetType: components['schemas']['ReportType'];
      targetId: string;
      reason: components['schemas']['ReportReason'];
      description?: string;
    };
    ContentReport: {
      targetType: components['schemas']['ReportType'];
      reason: components['schemas']['ReportReason'];
      status: components['schemas']['ReportStatus'];
      id: string;
      targetId: string;
      description?: string;
      reporterId: string;
      reporter: components['schemas']['User'];
      reviewerId?: string;
      reviewer?: components['schemas']['User'];
      reviewNotes?: string;
      resolvedAt?: string;
      createdAt: string;
      updatedAt: string;
    };
    FeedActivityType: "contributor_registered" | "grant_contribution" | "reputation_change";
    FeedActivityItemDto: {
      id: string;
      activityType: components['schemas']['FeedActivityType'];
      contributorAddress: string;
      githubHandle?: string;
      timestamp: string;
      summary: string;
      metadata?: Record<string, unknown>;
    };
    ContributorFeedResponseDto: {
      items: components['schemas']['FeedActivityItemDto'][];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      isSparseContributor: boolean;
    };
    AssetBalanceWithCurrencyDto: {
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
      value: number;
      valueUsd: number;
    };
    PortfolioSummaryWithCurrencyResponseDto: {
      totalValue: string;
      currency: "USD" | "EUR" | "GBP" | "NGN" | "XLM";
      totalValueUsd: string;
      assets: components['schemas']['AssetBalanceWithCurrencyDto'][];
      lastUpdated: string | null;
      hasLinkedAccount: boolean;
      exchangeRate: number;
    };
    ChartMetaDto: {
      xAxis: components['schemas']['ChartAxisMetaDto'];
      yAxes: components['schemas']['ChartAxisMetaDto'][];
      series: components['schemas']['ChartSeriesMetaDto'][];
      ranges: components['schemas']['ChartRangeOptionDto'][];
    };
    ChartDataPointDto: {
      timestamp: string;
      sentiment: number;
      count: number;
    };
    User: {
      id: string;
      email: string;
      passwordHash: string;
      firstName: string;
      lastName: string;
      displayName: string;
      bio: string;
      avatarUrl: string;
      stellarPublicKey: string;
      role: "user" | "reviewer" | "admin";
      preferences: Record<string, unknown>;
      twoFactorEnabled: boolean;
      twoFactorSecret: string | null;
      stellarAccounts: components['schemas']['StellarAccount'][];
      createdAt: string;
      updatedAt: string;
    };
    StellarAccount: {
      id: string;
      userId: string;
      user: components['schemas']['User'];
      publicKey: string;
      label: string | null;
      isPrimary: boolean;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    };
    ChartAxisMetaDto: {
      id: string;
      label: string;
    };
    ChartSeriesMetaDto: {
      key: string;
      label: string;
      axisId: string;
    };
    ChartRangeOptionDto: {
      range: "7d" | "30d";
      interval: "1h" | "1d";
      label: string;
    };
  };
}
