"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Bookmark, Pencil, Play, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import {
  SAVED_SEARCH_NAME_MAX,
  SavedSearchApiService,
  dispatchRunSavedSearch,
  savedSearchHref,
  validateSavedSearchName,
  type SavedSearch,
} from "@/lib/saved-search-service";

function describeFilters(filters: SavedSearch["filters"]): string {
  const parts = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => (k === "q" ? `“${String(v)}”` : `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`));
  return parts.length ? parts.join(" · ") : "No filters";
}

export default function SavedSearchesPanel() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setSearches(await SavedSearchApiService.list());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load saved searches");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = (updated: SavedSearch) =>
    setSearches((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

  const submitRename = async () => {
    if (!renaming) return;
    const error = validateSavedSearchName(renaming.name);
    if (error) {
      setRenaming({ ...renaming, error });
      return;
    }
    setBusyId(renaming.id);
    try {
      replace(await SavedSearchApiService.update(renaming.id, { name: renaming.name }));
      setRenaming(null);
    } catch (err) {
      setRenaming({
        ...renaming,
        error: err instanceof Error ? err.message : "Rename failed",
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSubscription = async (search: SavedSearch) => {
    setBusyId(search.id);
    setActionError(null);
    try {
      replace(await SavedSearchApiService.update(search.id, { isSubscribed: !search.isSubscribed }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update notifications");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setBusyId(target.id);
    setActionError(null);
    try {
      await SavedSearchApiService.remove(target.id);
      setSearches((prev) => prev.filter((s) => s.id !== target.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const run = (search: SavedSearch) => {
    const href = savedSearchHref(search);
    if (href) {
      router.push(href);
      return;
    }
    window.scrollTo({ top: 0 });
    dispatchRunSavedSearch(search.filters);
  };

  let body: React.ReactNode;
  if (isLoading && searches.length === 0) {
    body = <ListSkeleton count={3} />;
  } else if (loadError && searches.length === 0) {
    body = <ListError message={loadError} onRetry={() => void load()} />;
  } else if (searches.length === 0) {
    body = (
      <EmptyState
        icon={Bookmark}
        title="No saved searches yet"
        description="Run a search from the bar at the top of the page and choose “Save this search” to keep it here."
      />
    );
  } else {
    body = (
      <ul className="space-y-2" aria-label="Saved searches">
        {searches.map((search) => {
          const isRenaming = renaming?.id === search.id;
          const busy = busyId === search.id;
          return (
            <li
              key={search.id}
              data-testid={`saved-search-${search.id}`}
              className="flex flex-col gap-2 p-3 rounded-lg border border-white/5 bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitRename();
                    }}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        aria-label="New name"
                        value={renaming.name}
                        maxLength={SAVED_SEARCH_NAME_MAX}
                        autoFocus
                        disabled={busy}
                        onChange={(e) => setRenaming({ id: search.id, name: e.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-primary/60"
                      />
                      <button type="submit" disabled={busy} className="px-2 py-1 text-sm text-primary">
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className="px-2 py-1 text-sm text-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                    {renaming.error && (
                      <p role="alert" className="text-xs text-rose-300">
                        {renaming.error}
                      </p>
                    )}
                  </form>
                ) : (
                  <p className="truncate font-medium text-white">{search.name}</p>
                )}
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  <span className="mr-2 rounded bg-white/5 px-1.5 py-0.5 uppercase tracking-wide">
                    {search.domain}
                  </span>
                  {describeFilters(search.filters)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => run(search)}
                  aria-label={`Run ${search.name}`}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-primary hover:bg-primary/10"
                >
                  <Play className="h-3.5 w-3.5" />
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSubscription(search)}
                  disabled={busy}
                  aria-pressed={search.isSubscribed}
                  aria-label={
                    search.isSubscribed
                      ? `Stop notifications for ${search.name}`
                      : `Notify me about new results for ${search.name}`
                  }
                  title={search.isSubscribed ? "Notifications on" : "Notifications off"}
                  className="rounded-lg p-1.5 text-gray-300 hover:bg-white/10 disabled:opacity-50"
                >
                  {search.isSubscribed ? (
                    <Bell className="h-4 w-4 text-primary" />
                  ) : (
                    <BellOff className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming({ id: search.id, name: search.name })}
                  disabled={busy}
                  aria-label={`Rename ${search.name}`}
                  className="rounded-lg p-1.5 text-gray-300 hover:bg-white/10 disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(search)}
                  disabled={busy}
                  aria-label={`Delete ${search.name}`}
                  className="rounded-lg p-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div>
      {actionError && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {actionError}
        </p>
      )}
      {body}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-saved-search-title"
            aria-describedby="delete-saved-search-description"
            className="bg-gray-900 border border-white/10 rounded-xl p-6 w-96 max-w-[90vw]"
          >
            <h3 id="delete-saved-search-title" className="font-bold text-white mb-2">
              Delete saved search?
            </h3>
            <p id="delete-saved-search-description" className="text-sm text-gray-400 mb-4">
              “{pendingDelete.name}” will be removed
              {pendingDelete.isSubscribed ? " and its notifications cancelled" : ""}. This can&apos;t be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="px-3 py-1.5 text-sm bg-red-500 text-white rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
