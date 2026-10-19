"use client";

/**
 * GlobalSearch
 *
 * A reusable search bar that lets the user type a query, optionally select
 * filters, and save the resulting search under a name.  The component is
 * agnostic about where results are rendered — it calls `onRun` so the parent
 * can populate its own results area.
 *
 * Saving uses `useSavedSearches` directly so any consumer of <GlobalSearch />
 * automatically gets the "save the current search" capability referenced in
 * the saved-searches acceptance criteria.
 */

import { useCallback, useEffect, useState } from "react";
import { Search as SearchIcon, Bookmark, X } from "lucide-react";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import type { SavedSearchFilters } from "@/lib/search-api";

export interface GlobalSearchResult {
  query: string;
  filters: SavedSearchFilters;
}

interface GlobalSearchProps {
  /** Called when the user submits a search (Enter or clicking the search button). */
  onRun?: (result: GlobalSearchResult) => void;
  /** Optional controlled value for the query input. */
  initialQuery?: string;
  className?: string;
}

// Search "kind" maps to the backend search endpoints (projects / assets / ecosystem).
const SEARCH_KINDS = ["project", "asset", "ecosystem"] as const;
type SearchKind = (typeof SEARCH_KINDS)[number];

const DEFAULT_FILTERS: SavedSearchFilters = { kind: "project" };

export function GlobalSearch({
  onRun,
  initialQuery = "",
  className = "",
}: GlobalSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<SavedSearchFilters>(DEFAULT_FILTERS);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");

  const { createSearch, isMutating, error, items } = useSavedSearches();

  // Pre-fill the name input with the query when opening the save dialog.
  useEffect(() => {
    if (showSave && !name) {
      setName(query.trim() || "New search");
    }
  }, [showSave, name, query]);

  const runSearch = useCallback(() => {
    onRun?.({ query: query.trim(), filters });
  }, [query, filters, onRun]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    runSearch();
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // If a search with this exact name already exists locally we let the
    // backend return the conflict (409) and surface the error via the hook.
    await createSearch({
      name: trimmed,
      query: query.trim(),
      filters,
      notificationsEnabled: false,
    });

    setShowSave(false);
    setName("");
  }

  const canSave = query.trim().length > 0 || Object.keys(filters).length > 0;

  return (
    <div className={`w-full ${className}`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              aria-label="Search query"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects, assets, ecosystem…"
              className="w-full rounded-xl border border-white/10 bg-black/60 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-primary/60"
            />
          </div>

          {/* Kind selector */}
          <select
            aria-label="Search kind"
            value={(filters.kind as SearchKind) ?? "project"}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, kind: e.target.value }))
            }
            className="rounded-xl border border-white/10 bg-black/60 py-2.5 px-3 text-sm text-white outline-none transition focus:border-primary/60"
          >
            {SEARCH_KINDS.map((kind) => (
              <option key={kind} value={kind} className="capitalize">
                {kind}
              </option>
            ))}
          </select>

          {/* Run */}
          <button
            type="submit"
            aria-label="Run search"
            className="rounded-xl bg-primary/20 px-4 py-2.5 text-sm font-medium text-primary transition hover:bg-primary/30"
          >
            Search
          </button>

          {/* Save button */}
          <button
            type="button"
            aria-label="Save this search"
            onClick={() => setShowSave((prev) => !prev)}
            disabled={!canSave}
            className="rounded-xl border border-white/10 px-3 py-2.5 text-sm text-white/60 transition hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            title={canSave ? "Save this search" : "Enter a query to save"}
          >
            <Bookmark className="h-4 w-4" />
          </button>
        </div>

        {/* Inline save dialog */}
        {showSave && (
          <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
            <input
              aria-label="Name this saved search"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this search"
              maxLength={120}
              className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm text-white outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isMutating || !name.trim()}
              className="rounded-lg bg-primary/20 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/30 disabled:opacity-50"
            >
              {isMutating ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              aria-label="Cancel save"
              onClick={() => {
                setShowSave(false);
                setName("");
              }}
              className="rounded-lg p-1.5 text-white/40 transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Save error message */}
        {error && showSave && (
          <p className="text-xs text-red-300">{error}</p>
        )}
      </form>
    </div>
  );
}
