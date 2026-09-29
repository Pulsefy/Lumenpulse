"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Trophy, Bookmark, ChevronDown, Check } from "lucide-react";
import { GrantRound, RoundCard, RoundTable } from "./components";
import { DependencyStatusBanner } from "@/components/DependencyStatusBanner";
import { useWatchlist } from "@/hooks/use-watchlist";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

const STATUS_OPTIONS = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Upcoming", value: "PENDING" },
  { label: "Ended", value: "ENDED" },
  { label: "Finalized", value: "FINALIZED" },
  { label: "Distributed", value: "DISTRIBUTED" },
] as const;

const SORT_OPTIONS = [
  { label: "Newest", value: "endTime_desc" },
  { label: "Oldest", value: "endTime_asc" },
  { label: "Pool (High)", value: "totalPool_desc" },
  { label: "Pool (Low)", value: "totalPool_asc" },
  { label: "Name A-Z", value: "name_asc" },
  { label: "Name Z-A", value: "name_desc" },
] as const;

function filterRounds(rounds: GrantRound[], status: string): GrantRound[] {
  if (status === "ALL") return rounds;
  return rounds.filter((r) => r.status === status);
}

function sortRounds(rounds: GrantRound[], sortValue: string): GrantRound[] {
  const idx = sortValue.lastIndexOf("_");
  const field = sortValue.slice(0, idx);
  const order = sortValue.slice(idx + 1) as "asc" | "desc";
  return [...rounds].sort((a, b) => {
    let cmp = 0;
    if (field === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (field === "endTime") {
      cmp = a.endTime - b.endTime;
    } else if (field === "totalPool") {
      cmp = Number(a.totalPool) - Number(b.totalPool);
    }
    return order === "desc" ? -cmp : cmp;
  });
}

export default function GrantsPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [rounds, setRounds] = useState<GrantRound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [isSortOpen, setIsSortOpen] = useState(false);
  const { isProjectSaved } = useWatchlist();

  const status = searchParams.get("status") || "ALL";
  const sort = searchParams.get("sort") || "endTime_desc";

  useEffect(() => {
    fetch(`${API_BASE}/grants/rounds`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load grant rounds.");
        }
        return response.json();
      })
      .then((data: GrantRound[]) => setRounds(data))
      .catch((err) => setError(err.message || "Failed to load grant rounds."))
      .finally(() => setIsLoading(false));
  }, []);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (
        (key === "status" && value === "ALL") ||
        (key === "sort" && value === "endTime_desc")
      ) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/grants?${qs}` : "/grants", { scroll: false });
    },
    [searchParams, router]
  );

  let filtered = rounds;
  if (showSavedOnly) {
    filtered = filtered.filter((r) => isProjectSaved(r.id));
  }
  filtered = filterRounds(filtered, status);
  filtered = sortRounds(filtered, sort);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Trophy className="w-7 h-7 text-primary" />
              <h1 className="text-3xl font-bold tracking-tight">Grants</h1>
            </div>
            {rounds.length > 0 && (
              <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10">
                <button
                  onClick={() => setShowSavedOnly(false)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    !showSavedOnly ? "bg-white/10 text-white shadow" : "text-foreground/50 hover:text-foreground"
                  }`}
                >
                  All Rounds
                </button>
                <button
                  onClick={() => setShowSavedOnly(true)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    showSavedOnly ? "bg-white/10 text-white shadow" : "text-foreground/50 hover:text-foreground"
                  }`}
                >
                  <Bookmark className="w-4 h-4" />
                  Watchlist
                </button>
              </div>
            )}
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            Community-funded matching rounds using quadratic funding. More contributors means more
            matching — not just bigger donations.
          </p>

          <div className="mt-6">
            <DependencyStatusBanner />
          </div>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {isLoading ? (
            <div className="py-20">
              <ListSkeleton count={4} rowHeight={180} variant="grid" gridCols={2} />
            </div>
          ) : error ? (
            <ListError
              message={error}
              onRetry={() => window.location.reload()}
            />
          ) : rounds.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No grant rounds available"
              description="Grant rounds will appear here once they are created. Check back later!"
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by status">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateParam("status", opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        status === opt.value
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "text-foreground/50 hover:text-foreground border border-transparent"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <button
                    onClick={() => setIsSortOpen((prev) => !prev)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
                    aria-haspopup="listbox"
                    aria-expanded={isSortOpen}
                  >
                    <span className="text-foreground/50">Sort:</span>
                    <span>{SORT_OPTIONS.find((o) => o.value === sort)?.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isSortOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isSortOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsSortOpen(false)}
                        aria-hidden="true"
                      />
                      <div
                        className="absolute right-0 mt-2 w-48 bg-black/90 border border-white/10 rounded-xl shadow-2xl z-20 overflow-hidden backdrop-blur-2xl"
                        role="listbox"
                        aria-label="Sort options"
                      >
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              updateParam("sort", opt.value);
                              setIsSortOpen(false);
                            }}
                            className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-primary/20 transition-all"
                            role="option"
                            aria-selected={sort === opt.value}
                          >
                            {opt.label}
                            {sort === opt.value && <Check className="w-4 h-4 text-primary" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filtered.map((round) => (
                  <RoundCard key={round.id} round={round} />
                ))}
              </div>

              <div className="hidden md:block">
                <RoundTable rounds={filtered} />
              </div>

              {filtered.length === 0 && (
                <EmptyState
                  icon={Bookmark}
                  title={showSavedOnly ? "Watchlist is empty" : "No matching rounds"}
                  description={showSavedOnly
                    ? "Save grant rounds to your watchlist to see them here."
                    : `No rounds with status "${STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status}".`}
                  action={showSavedOnly ? {
                    label: "Browse all rounds",
                    onClick: () => setShowSavedOnly(false),
                  } : undefined}
                />
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
