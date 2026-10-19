"use client";

/**
 * SavedSearchesPanel
 *
 * A self-contained panel that lists the authenticated user's saved searches.
 * It covers all five acceptance criteria:
 *
 *  1. Create / name a search (via the `GlobalSearch` component or the page
 *     that embeds this panel — the `onRunSearch` callback re-runs it).
 *  2. Rename, re-run, and delete (delete with inline confirmation).
 *  3. Running a search restores its filters via the `onRunSearch` callback.
 *  4. Notification subscription toggle per search.
 *  5. Loading, empty and error states via shared components.
 */

import { useState } from "react";
import {
  Bell,
  BellOff,
  Search,
  Trash2,
  Pencil,
  Check,
  X,
  AlertCircle,
  Bookmark,
} from "lucide-react";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import type { SavedSearch, SavedSearchFilters } from "@/lib/search-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callers supply this callback to re-run the search in their own context. */
export interface RunSearchArgs {
  query: string;
  filters: SavedSearchFilters;
}

interface SavedSearchesPanelProps {
  /** Called when the user clicks "Run" on a saved search. */
  onRunSearch?: (args: RunSearchArgs) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <ul className="space-y-3" aria-label="Loading saved searches">
      {[1, 2, 3].map((n) => (
        <li
          key={n}
          className="h-16 rounded-xl bg-white/5 animate-pulse border border-white/5"
        />
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-white/10 bg-white/5">
      <Bookmark className="h-10 w-10 text-white/20 mb-4" />
      <p className="text-base font-medium text-white">No saved searches</p>
      <p className="mt-2 max-w-xs text-sm text-white/50">
        Run a search and use the save button to pin it here for quick access.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-300">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 transition hover:bg-red-500/20"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual search row
// ---------------------------------------------------------------------------

interface SearchRowProps {
  search: SavedSearch;
  onRun: (search: SavedSearch) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onToggleNotifications: (id: string, enabled: boolean) => void;
  isDeleting: boolean;
}

function SearchRow({
  search,
  onRun,
  onRename,
  onDelete,
  onToggleNotifications,
  isDeleting,
}: SearchRowProps) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(search.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function commitRename() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== search.name) {
      onRename(search.id, trimmed);
    }
    setEditingName(false);
  }

  function cancelRename() {
    setNameValue(search.name);
    setEditingName(false);
  }

  return (
    <li
      className={`rounded-xl border bg-white/[0.02] transition-all ${
        confirmDelete
          ? "border-red-500/40 bg-red-500/5"
          : "border-white/10 hover:border-white/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Search icon */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Search className="h-4 w-4" />
        </div>

        {/* Name + query summary */}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="Rename saved search"
                autoFocus
                className="flex-1 rounded-lg border border-primary/40 bg-black/60 px-2 py-1 text-sm text-white outline-none focus:border-primary"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                }}
                maxLength={120}
              />
              <button
                aria-label="Confirm rename"
                onClick={commitRename}
                className="rounded-lg p-1 text-primary hover:bg-primary/20"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                aria-label="Cancel rename"
                onClick={cancelRename}
                className="rounded-lg p-1 text-white/50 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <p className="truncate text-sm font-medium text-white">
                {search.name}
              </p>
              {search.query && (
                <p className="truncate text-xs text-white/40">
                  &ldquo;{search.query}&rdquo;
                </p>
              )}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Run search */}
          <button
            aria-label={`Run saved search: ${search.name}`}
            onClick={() => onRun(search)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
          >
            Run
          </button>

          {/* Rename */}
          {!editingName && !confirmDelete && (
            <button
              aria-label={`Rename ${search.name}`}
              onClick={() => setEditingName(true)}
              className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Notifications toggle */}
          {!confirmDelete && (
            <button
              aria-label={
                search.notificationsEnabled
                  ? `Disable notifications for ${search.name}`
                  : `Enable notifications for ${search.name}`
              }
              onClick={() =>
                onToggleNotifications(search.id, !search.notificationsEnabled)
              }
              title={
                search.notificationsEnabled
                  ? "Notifications on – click to disable"
                  : "Notifications off – click to enable"
              }
              className={`rounded-lg p-1.5 transition ${
                search.notificationsEnabled
                  ? "text-primary hover:bg-primary/20"
                  : "text-white/30 hover:bg-white/10 hover:text-white/60"
              }`}
            >
              {search.notificationsEnabled ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <BellOff className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {/* Delete — two-step confirmation */}
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-red-300">Delete?</span>
              <button
                aria-label="Confirm delete"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(search.id);
                }}
                disabled={isDeleting}
                className="rounded-lg border border-red-500/50 px-2 py-0.5 text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                Yes
              </button>
              <button
                aria-label="Cancel delete"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-white/20 px-2 py-0.5 text-white/60 transition hover:bg-white/10"
              >
                No
              </button>
            </div>
          ) : (
            <button
              aria-label={`Delete saved search: ${search.name}`}
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg p-1.5 text-white/30 transition hover:bg-red-500/20 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter badges — surfaces the stored filters so the user knows what
          will be applied when they hit Run. */}
      {Object.keys(search.filters).length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {Object.entries(search.filters).map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50"
            >
              {key}:{" "}
              <span className="ml-1 text-white/70">
                {String(value)}
              </span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SavedSearchesPanel({
  onRunSearch,
  className = "",
}: SavedSearchesPanelProps) {
  const {
    items,
    isLoading,
    isMutating,
    error,
    refresh,
    updateSearch,
    deleteSearch,
    toggleNotifications,
  } = useSavedSearches();

  function handleRun(search: SavedSearch) {
    onRunSearch?.({ query: search.query, filters: search.filters });
  }

  async function handleRename(id: string, newName: string) {
    await updateSearch(id, { name: newName });
  }

  async function handleDelete(id: string) {
    await deleteSearch(id);
  }

  async function handleToggleNotifications(id: string, enabled: boolean) {
    await toggleNotifications(id, enabled);
  }

  return (
    <section
      aria-label="Saved searches"
      className={`rounded-2xl border border-white/10 bg-black/60 p-5 shadow-xl backdrop-blur-md ${className}`}
    >
      {/* Panel header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-white">Saved Searches</h2>
          {!isLoading && items.length > 0 && (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {items.length}
            </span>
          )}
        </div>
        {isMutating && (
          <span className="text-xs text-white/30 animate-pulse">Saving…</span>
        )}
      </div>

      {/* States */}
      {error && <ErrorState message={error} onRetry={refresh} />}

      {isLoading ? (
        <LoadingSkeleton />
      ) : items.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {items.map((search) => (
            <SearchRow
              key={search.id}
              search={search}
              onRun={handleRun}
              onRename={handleRename}
              onDelete={handleDelete}
              onToggleNotifications={handleToggleNotifications}
              isDeleting={isMutating}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
