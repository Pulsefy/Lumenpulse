"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  Filter,
  ChevronDown,
  Check,
  Wallet,
  Users,
  Calendar,
  Bookmark,
  Trophy,
  X,
} from "lucide-react";
import { DependencyStatusBanner } from "@/components/DependencyStatusBanner";
import { useWatchlist } from "@/hooks/use-watchlist";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

interface ProjectSummary {
  id: number;
  name: string;
  description?: string;
  targetAmount: string;
  totalDeposited: string;
  totalWithdrawn: string;
  isActive: boolean;
  onChainStatus: "ACTIVE" | "COMPLETED" | "PAUSED" | "CANCELLED";
  contributorCount: number;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Paused", value: "PAUSED" },
  { label: "Cancelled", value: "CANCELLED" },
] as const;

const SORT_OPTIONS = [
  { label: "Most Funded", value: "totalDeposited_desc" },
  { label: "Least Funded", value: "totalDeposited_asc" },
  { label: "Newest", value: "createdAt_desc" },
  { label: "Oldest", value: "createdAt_asc" },
  { label: "Name A-Z", value: "name_asc" },
  { label: "Name Z-A", value: "name_desc" },
  { label: "Most Contributors", value: "contributorCount_desc" },
] as const;

function formatXLM(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return "0.00";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getProgressPercentage(current: string, target: string): number {
  const currentNum = parseFloat(current);
  const targetNum = parseFloat(target);
  if (targetNum === 0) return 0;
  return Math.min(100, (currentNum / targetNum) * 100);
}

function getStatusColor(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "COMPLETED":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "PAUSED":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "CANCELLED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    default:
      return "bg-white/5 text-white/40 border-white/10";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "COMPLETED":
      return "Completed";
    case "PAUSED":
      return "Paused";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusColor(status)}`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const progress = getProgressPercentage(project.totalDeposited, project.targetAmount);

  return (
    <Link href={`/projects/${project.id}`}>
      <div className="group relative flex flex-col gap-4 p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-xs text-foreground/40 mt-1 line-clamp-2">
                {project.description}
              </p>
            )}
          </div>
          <StatusBadge status={project.onChainStatus} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground/50">Progress</span>
            <span className="font-bold">{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-foreground/40">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Wallet className="w-3 h-3 text-primary" />
              {formatXLM(project.totalDeposited)} / {formatXLM(project.targetAmount)} XLM
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {project.contributorCount}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(project.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function FilterDropdown({
  options,
  value,
  onChange,
  label,
  icon: Icon,
}: {
  options: readonly { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-foreground/50" />}
        <span className="text-foreground/50">{label}:</span>
        <span>{options.find((o) => o.value === value)?.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            className="absolute right-0 mt-2 w-48 bg-black/90 border border-white/10 rounded-xl shadow-2xl z-20 overflow-hidden backdrop-blur-2xl"
            role="listbox"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-white hover:bg-primary/20 transition-all"
                role="option"
                aria-selected={value === opt.value}
              >
                {opt.label}
                {value === opt.value && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProjectsPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { isProjectSaved } = useWatchlist();

  const status = searchParams.get("status") || "ALL";
  const sort = searchParams.get("sort") || "totalDeposited_desc";

  useEffect(() => {
    fetch(`${API_BASE}/crowdfund/projects`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load projects.");
        }
        return response.json();
      })
      .then((data: ProjectSummary[]) => setProjects(data))
      .catch((err) => setError(err.message || "Failed to load projects."))
      .finally(() => setIsLoading(false));
  }, []);

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (
        (key === "status" && value === "ALL") ||
        (key === "sort" && value === "totalDeposited_desc")
      ) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `/projects?${qs}` : "/projects", { scroll: false });
    },
    [searchParams, router]
  );

  let filtered = [...projects];

  // Search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.description && p.description.toLowerCase().includes(query))
    );
  }

  // Watchlist filter
  if (showSavedOnly) {
    filtered = filtered.filter((p) => isProjectSaved(p.id));
  }

  // Status filter
  if (status !== "ALL") {
    filtered = filtered.filter((p) => p.onChainStatus === status);
  }

  // Sort
  const sortField = sort.slice(0, sort.lastIndexOf("_"));
  const sortOrder = sort.slice(sort.lastIndexOf("_") + 1) as "asc" | "desc";

  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortField === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField === "createdAt") {
      cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortField === "totalDeposited") {
      cmp = parseFloat(a.totalDeposited) - parseFloat(b.totalDeposited);
    } else if (sortField === "contributorCount") {
      cmp = a.contributorCount - b.contributorCount;
    }
    return sortOrder === "desc" ? -cmp : cmp;
  });

  const clearFilters = () => {
    setSearchQuery("");
    setShowSavedOnly(false);
    updateParam("status", "ALL");
    updateParam("sort", "totalDeposited_desc");
  };

  const hasActiveFilters = searchQuery || showSavedOnly || status !== "ALL" || sort !== "totalDeposited_desc";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <Trophy className="w-7 h-7 text-primary" />
              <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
              <span className="text-sm text-foreground/40 font-medium">
                ({projects.length})
              </span>
            </div>
            {projects.length > 0 && (
              <div className="flex items-center bg-white/5 rounded-lg p-1 border border-white/10">
                <button
                  onClick={() => setShowSavedOnly(false)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    !showSavedOnly ? "bg-white/10 text-white shadow" : "text-foreground/50 hover:text-foreground"
                  }`}
                >
                  All Projects
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
            Explore community-funded projects. Contribute to projects you believe in and track their progress.
          </p>
          <div className="mt-6">
            <DependencyStatusBanner />
          </div>
        </div>
      </section>

      {/* Content */}
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
          ) : projects.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No projects available"
              description="Projects will appear here once they are created. Check back later!"
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                  <input
                    type="text"
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-foreground/30 focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <FilterDropdown
                    options={STATUS_OPTIONS}
                    value={status}
                    onChange={(value) => updateParam("status", value)}
                    label="Status"
                  />
                  <FilterDropdown
                    options={SORT_OPTIONS}
                    value={sort}
                    onChange={(value) => updateParam("sort", value)}
                    label="Sort"
                  />
                  {hasActiveFilters && (
                    <button
                      onClick={clearFilters}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-foreground/40 hover:text-foreground hover:bg-white/5 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Results */}
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title={showSavedOnly ? "Watchlist is empty" : searchQuery ? "No matching projects" : "No matching projects"}
                  description={showSavedOnly
                    ? "Save projects to your watchlist to see them here."
                    : searchQuery
                      ? `No projects found matching "${searchQuery}"`
                      : `No projects with status "${getStatusLabel(status)}".`}
                  action={hasActiveFilters ? {
                    label: "Clear all filters",
                    onClick: clearFilters,
                  } : showSavedOnly ? {
                    label: "Browse all projects",
                    onClick: () => setShowSavedOnly(false),
                  } : undefined}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filtered.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}