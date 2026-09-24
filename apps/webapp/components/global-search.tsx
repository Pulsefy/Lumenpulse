"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
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
} from "lucide-react";
import {
  runGlobalSearch,
  type GlobalSearchGroup,
  type GlobalSearchResultItem,
  type SearchCategory,
} from "@/lib/search-api";
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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

            <p className="mt-1 border-t border-white/10 px-2 pt-2 text-[10px] text-white/35">
              ⌘K / Ctrl+K to focus · Esc to close
            </p>
          </div>
        </>
      )}
    </div>
  );
}
