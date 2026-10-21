"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  AlertCircle,
  FolderKanban,
  Coins,
  Tags,
  Link2,
  X,
  Bookmark,
  Check,
} from "lucide-react";
import {
  runGlobalSearch,
  type GlobalSearchGroup,
  type GlobalSearchResultItem,
  type SearchCategory,
} from "@/lib/search-api";
import {
  GLOBAL_SEARCH_DOMAIN,
  RUN_SAVED_SEARCH_EVENT,
  SavedSearchApiService,
  filtersFromGlobalQuery,
  globalQueryFromFilters,
  validateSavedSearchName,
  type RunSavedSearchDetail,
} from "@/lib/saved-search-service";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 280;

const CATEGORY_ICON: Record<
  SearchCategory,
  ComponentType<{ className?: string }>
> = {
  projects: FolderKanban,
  assets: Coins,
  ecosystem: Tags,
  "entity-links": Link2,
};

type SearchStatus = "idle" | "loading" | "ready" | "empty" | "error";

type SaveState =
  | { kind: "closed" }
  | { kind: "editing"; name: string; error?: string }
  | { kind: "saving"; name: string }
  | { kind: "saved"; name: string };

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [groups, setGroups] = useState<GlobalSearchGroup[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [save, setSave] = useState<SaveState>({ kind: "closed" });

  const flatItems = useMemo(() => {
    const items: GlobalSearchResultItem[] = [];
    for (const group of groups) {
      items.push(...group.items);
    }
    return items;
  }, [groups]);

  const cancelInFlight = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const executeSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setGroups([]);
        setStatus("idle");
        setErrorMessage(null);
        setActiveIndex(-1);
        return;
      }

      cancelInFlight();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setErrorMessage(null);

      try {
        const result = await runGlobalSearch(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        setGroups(result.groups);
        setActiveIndex(result.totalCount > 0 ? 0 : -1);
        setStatus(result.totalCount === 0 ? "empty" : "ready");
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          return;
        }
        setGroups([]);
        setActiveIndex(-1);
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Search failed. Try again.",
        );
      }
    },
    [cancelInFlight],
  );

  const scheduleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      setSave({ kind: "closed" });
      setOpen(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        cancelInFlight();
        setGroups([]);
        setStatus("idle");
        setErrorMessage(null);
        setActiveIndex(-1);
        return;
      }
      setStatus("loading");
      debounceRef.current = setTimeout(() => {
        void executeSearch(value);
      }, DEBOUNCE_MS);
    },
    [cancelInFlight, executeSearch],
  );

  useEffect(() => () => cancelInFlight(), [cancelInFlight]);

  // Re-running a saved search restores its stored query and runs it at once.
  useEffect(() => {
    const onRun = (event: Event) => {
      const { filters } = (event as CustomEvent<RunSavedSearchDetail>).detail;
      const restored = globalQueryFromFilters(filters);
      setQuery(restored);
      setSave({ kind: "closed" });
      setOpen(true);
      inputRef.current?.focus();
      void executeSearch(restored);
    };
    window.addEventListener(RUN_SAVED_SEARCH_EVENT, onRun);
    return () => window.removeEventListener(RUN_SAVED_SEARCH_EVENT, onRun);
  }, [executeSearch]);

  const submitSave = useCallback(async () => {
    if (save.kind !== "editing") return;
    const error = validateSavedSearchName(save.name);
    if (error) {
      setSave({ ...save, error });
      return;
    }
    const name = save.name.trim();
    setSave({ kind: "saving", name });
    try {
      await SavedSearchApiService.create({
        name,
        domain: GLOBAL_SEARCH_DOMAIN,
        filters: filtersFromGlobalQuery(query),
      });
      setSave({ kind: "saved", name });
    } catch (err) {
      setSave({
        kind: "editing",
        name,
        error: err instanceof Error ? err.message : "Could not save search.",
      });
    }
  }, [save, query]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectItem = useCallback(
    (item: GlobalSearchResultItem) => {
      setOpen(false);
      setQuery("");
      setGroups([]);
      setStatus("idle");
      router.push(item.href);
    },
    [router],
  );

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
      setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setActiveIndex(
        (prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1),
      );
      setOpen(true);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && flatItems[activeIndex]) {
        selectItem(flatItems[activeIndex]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    flatItems.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [flatItems]);

  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/80" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => scheduleSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Search projects, assets…"
          aria-label="Global search"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 && flatItems[activeIndex]
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          role="combobox"
          className="w-full rounded-xl border border-primary/25 bg-white/5 py-2 pl-9 pr-9 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-primary/60 focus:bg-white/10"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
            onClick={() => {
              cancelInFlight();
              setQuery("");
              setGroups([]);
              setStatus("idle");
              setErrorMessage(null);
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close search"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            id={listboxId}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-[min(70vh,28rem)] overflow-y-auto rounded-2xl border border-primary/25 bg-black/95 p-2 shadow-2xl shadow-primary/10 backdrop-blur-xl"
          >
            {status === "idle" && (
              <p className="px-3 py-4 text-sm text-white/50">
                Type to search projects, assets, ecosystem tags, and linked
                entities. Use ↑↓ and Enter to navigate.
              </p>
            )}

            {status === "loading" && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Searching…
              </div>
            )}

            {status === "error" && (
              <div className="flex items-start gap-2 px-3 py-4 text-sm text-rose-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Search unavailable</p>
                  <p className="mt-1 text-rose-200/80">
                    {errorMessage ?? "Something went wrong."}
                  </p>
                </div>
              </div>
            )}

            {status === "empty" && (
              <div className="px-3 py-4 text-sm text-white/60">
                No results for{" "}
                <span className="font-medium text-white">“{query.trim()}”</span>
                . Try a different project name, asset code, or keyword.
              </div>
            )}

            {status === "ready" &&
              groups.map((group) => {
                if (group.items.length === 0) return null;
                const Icon = CATEGORY_ICON[group.category];
                return (
                  <div key={group.category} className="mb-2 last:mb-0">
                    <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        {group.label}
                      </span>
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] tracking-normal text-primary">
                        {group.count}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => {
                        const index = indexById.get(item.id) ?? -1;
                        const active = index === activeIndex;
                        return (
                          <li key={item.id} role="presentation">
                            <button
                              type="button"
                              id={`${listboxId}-option-${index}`}
                              role="option"
                              aria-selected={active}
                              className={cn(
                                "flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition",
                                active
                                  ? "bg-primary/20 text-white"
                                  : "text-white/85 hover:bg-white/5",
                              )}
                              onMouseEnter={() => setActiveIndex(index)}
                              onClick={() => selectItem(item)}
                            >
                              <span className="text-sm font-medium">
                                {item.title}
                              </span>
                              {item.subtitle ? (
                                <span className="mt-0.5 text-xs text-white/50">
                                  {item.subtitle}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}

            {(status === "ready" || status === "empty") && query.trim() && (
              <div className="mt-1 border-t border-white/10 px-2 pt-2">
                {save.kind === "closed" && (
                  <button
                    type="button"
                    onClick={() => setSave({ kind: "editing", name: query.trim() })}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-primary hover:bg-primary/10"
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    Save this search
                  </button>
                )}
                {(save.kind === "editing" || save.kind === "saving") && (
                  <form
                    className="flex flex-col gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitSave();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        aria-label="Saved search name"
                        value={save.name}
                        maxLength={120}
                        disabled={save.kind === "saving"}
                        autoFocus
                        onChange={(e) => setSave({ kind: "editing", name: e.target.value })}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="min-w-0 flex-1 rounded-lg border border-primary/25 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-primary/60"
                      />
                      <button
                        type="submit"
                        disabled={save.kind === "saving"}
                        className="rounded-lg bg-primary/20 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/30 disabled:opacity-50"
                      >
                        {save.kind === "saving" ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSave({ kind: "closed" })}
                        className="rounded-lg px-2 py-1 text-xs text-white/50 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                    {save.kind === "editing" && save.error && (
                      <p role="alert" className="text-xs text-rose-300">
                        {save.error}
                      </p>
                    )}
                  </form>
                )}
                {save.kind === "saved" && (
                  <p className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Saved as “{save.name}”
                  </p>
                )}
              </div>
            )}

            <p className="mt-1 flex items-center justify-between border-t border-white/10 px-2 pt-2 text-[10px] text-white/35">
              <span>⌘K / Ctrl+K to focus · Esc to close</span>
              <Link
                href="/saved-searches"
                onClick={() => setOpen(false)}
                className="text-primary/80 hover:text-primary"
              >
                Saved searches
              </Link>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
