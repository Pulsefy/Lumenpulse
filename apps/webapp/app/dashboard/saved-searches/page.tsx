"use client";

/**
 * /dashboard/saved-searches page
 *
 * Surfaces the full saved-search experience: a GlobalSearch bar so users can
 * save new searches, and the SavedSearchesPanel for managing them.  Running
 * a saved search from the panel updates the search bar so the user can see
 * the restored query and filters before re-running.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bookmark } from "lucide-react";
import { GlobalSearch, type GlobalSearchResult } from "@/components/global-search";
import { SavedSearchesPanel, type RunSearchArgs } from "@/components/saved-searches-panel";
import type { SavedSearchFilters } from "@/lib/search-api";

export default function SavedSearchesPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [pendingQuery, setPendingQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    const authToken = document.cookie.includes("auth-token");
    if (!authToken) {
      router.push("/auth/login?callbackUrl=/dashboard/saved-searches");
      return;
    }
    setIsLoading(false);
  }, [router]);

  const handleRunSearch = useCallback((result: GlobalSearchResult) => {
    // In a real deployment this would push the query to the results page.
    // For the dashboard surface we keep the query in the search bar so the
    // user can refine and re-save without losing context.
    setPendingQuery(result.query);
  }, []);

  const handleRunSavedSearch = useCallback(
    (args: RunSearchArgs) => {
      // Restoring a saved search re-populates the GlobalSearch bar so the
      // user can see (and re-save) the exact query + filters.
      setPendingQuery(args.query);
      void handleRunSearch({ query: args.query, filters: args.filters });
    },
    [handleRunSearch],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </button>
      </div>

      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-primary/10 rounded-xl">
          <Bookmark size={28} className="text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Saved Searches</h1>
          <p className="text-gray-400 mt-1">
            Pin and revisit your search queries and filters
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-6">
        <GlobalSearch initialQuery={pendingQuery} onRun={handleRunSearch} />
        <SavedSearchesPanel onRunSearch={handleRunSavedSearch} />
      </div>
    </div>
  );
}
