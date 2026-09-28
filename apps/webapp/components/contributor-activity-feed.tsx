"use client";

import { useState } from "react";
import { Clock, Github, Circle, Loader2 } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import { useContributorFeed, type FeedActivityItem } from "@/hooks/useContributorFeed";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";

const ACTIVITY_ICONS: Record<FeedActivityItem["activityType"], typeof Circle> = {
  contributor_registered: Github,
  grant_contribution: Circle,
  reputation_change: Circle,
};

const ACTIVITY_LABELS: Record<FeedActivityItem["activityType"], string> = {
  contributor_registered: "Registered as contributor",
  grant_contribution: "Made a grant contribution",
  reputation_change: "Reputation changed",
};

interface ContributorActivityFeedProps {
  /** Optional address to filter by specific contributor */
  contributorAddress?: string;
  /** Items per page */
  limit?: number;
  /** Whether to show pagination/infinite scroll */
  paginated?: boolean;
}

export function ContributorActivityFeed({
  contributorAddress,
  limit = 20,
  paginated = true,
}: ContributorActivityFeedProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const {
    items,
    total,
    page,
    totalPages,
    isLoading,
    error,
    loadMore,
    refresh,
  } = useContributorFeed({
    contributorAddress,
    limit,
    sortOrder: "DESC",
  });

  if (isLoading && items.length === 0) {
    return <ListSkeleton count={5} rowHeight={80} variant="list" />;
  }

  if (error) {
    return <ListError message={error} onRetry={refresh} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Github}
        title="No activity yet"
        description={contributorAddress
          ? "This contributor hasn't had any activity yet."
          : "No contributor activity to display."}
      />
    );
  }

  const renderTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const relative = formatDistanceToNowStrict(date, { addSuffix: true });
    return (
      <time dateTime={timestamp} title={date.toLocaleString()}>
        {relative}
      </time>
    );
  };

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const Icon = ACTIVITY_ICONS[item.activityType];
        const isExpanded = expandedItem === item.id;

        return (
          <div
            key={item.id}
            className={cn(
              "group rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:bg-white/[0.05]",
              isExpanded && "bg-white/[0.03]"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center",
                  item.activityType === "contributor_registered" &&
                    "bg-purple-500/10 text-purple-400",
                  item.activityType === "grant_contribution" &&
                    "bg-emerald-500/10 text-emerald-400",
                  item.activityType === "reputation_change" &&
                    "bg-amber-500/10 text-amber-400"
                )}
              >
                <Icon className="w-5 h-5" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm text-foreground">
                    {ACTIVITY_LABELS[item.activityType]}
                  </p>
                  <renderTimestamp(item.timestamp) />
                </div>

                <p className="text-foreground/60 text-sm mt-1 line-clamp-2">
                  {item.summary}
                </p>

                {item.githubHandle && (
                  <div className="flex items-center gap-2 mt-2">
                    <Github className="w-3.5 h-3.5 text-foreground/40" />
                    <a
                      href={`https://github.com/${item.githubHandle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-sm hover:underline font-mono"
                    >
                      @{item.githubHandle}
                    </a>
                    {item.contributorAddress && (
                      <>
                        <span className="text-foreground/20">·</span>
                        <a
                          href={`https://stellar.expert/explorer/public/account/${item.contributorAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground/40 text-xs hover:text-foreground/60 font-mono"
                        >
                          {item.contributorAddress.slice(0, 8)}...{item.contributorAddress.slice(-6)}
                        </a>
                      </>
                    )}
                  </div>
                )}

                {isExpanded && item.metadata && (
                  <details className="mt-3 pt-3 border-t border-white/5">
                    <summary className="text-xs text-foreground/40 cursor-pointer select-none">
                      Show metadata
                    </summary>
                    <pre className="mt-2 p-3 rounded-lg bg-white/5 text-[10px] text-foreground/50 overflow-auto max-h-32">
                      {JSON.stringify(item.metadata, null, 2)}
                    </pre>
                  </details>
                )}
              </div>

              <button
                onClick={() =>
                  setExpandedItem((prev) => (prev === item.id ? null : item.id))
                }
                className={cn(
                  "flex-shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors",
                  isExpanded && "rotate-180"
                )}
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      })}

      {paginated && page < totalPages && (
        <div className="text-center pt-4">
          <button
            onClick={loadMore}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-sm font-medium text-foreground/60 hover:bg-white/5 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </>
            ) : (
              `Load more (${items.length}/${total})`
            )}
          </button>
        </div>
      )}
    </div>
  );
}