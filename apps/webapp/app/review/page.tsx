"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Clock,
  FileText,
  ChevronRight,
  AlertTriangle,
  Lock,
  Loader2,
} from "lucide-react";
import { SubmissionApiService } from "@/lib/submission-service";
import type { ProjectSubmission, SubmissionStatus } from "@/types/submission";

const FILTER_TABS: {
  label: string;
  value: SubmissionStatus | "ALL";
  icon: typeof Clock;
}[] = [
  { label: "All", value: "ALL", icon: FileText },
  { label: "In Review", value: "IN_REVIEW", icon: Clock },
  { label: "Changes Requested", value: "CHANGES_REQUESTED", icon: AlertTriangle },
  { label: "Approved", value: "APPROVED", icon: ShieldCheck },
  { label: "Draft", value: "DRAFT", icon: FileText },
  { label: "Published", value: "PUBLISHED", icon: ShieldCheck },
];

const STATUS_STYLES: Record<SubmissionStatus, { color: string; bg: string; border: string }> = {
  DRAFT: {
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  },
  IN_REVIEW: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  CHANGES_REQUESTED: {
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  APPROVED: {
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  PUBLISHED: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
};

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
  PUBLISHED: "Published",
};

function hasAuthToken(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith("auth-token="));
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export default function ReviewPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);
  const [filter, setFilter] = useState<SubmissionStatus | "ALL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    setIsAuthed(hasAuthToken());
  }, []);

  const fetchSubmissions = async (status?: SubmissionStatus | "ALL") => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await SubmissionApiService.listSubmissions(
        status && status !== "ALL" ? status : undefined,
      );
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
      setSubmissions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions(filter === "ALL" ? undefined : filter);
  }, [filter]);

  const counts = {
    ALL: submissions.length,
    DRAFT: submissions.filter((s) => s.status === "DRAFT").length,
    IN_REVIEW: submissions.filter((s) => s.status === "IN_REVIEW").length,
    CHANGES_REQUESTED: submissions.filter((s) => s.status === "CHANGES_REQUESTED").length,
    APPROVED: submissions.filter((s) => s.status === "APPROVED").length,
    PUBLISHED: submissions.filter((s) => s.status === "PUBLISHED").length,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Review Workspace</h1>
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            Review project and grant submissions, request changes, and approve
            content for publication.
          </p>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl space-y-6">
          {!isAuthed && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <Lock className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-400">Reviewer access required</p>
                <p className="text-xs text-foreground/50 mt-1">
                  You must be signed in to review submissions.{" "}
                  <Link
                    href="/auth/login"
                    className="text-primary hover:underline"
                  >
                    Sign in
                  </Link>{" "}
                  to continue.
                </p>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {([
              { label: "In Review", count: counts.IN_REVIEW, color: "text-amber-400" },
              { label: "Changes", count: counts.CHANGES_REQUESTED, color: "text-orange-400" },
              { label: "Approved", count: counts.APPROVED, color: "text-emerald-400" },
              { label: "Draft", count: counts.DRAFT, color: "text-slate-400" },
              { label: "Published", count: counts.PUBLISHED, color: "text-blue-400" },
              { label: "Total", count: counts.ALL, color: "text-foreground/70" },
            ]).map(({ label, count, color }) => (
              <div
                key={label}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center"
              >
                <p className={`text-xl font-bold ${color}`}>{count}</p>
                <p className="text-foreground/40 text-[10px] mt-1 uppercase tracking-wider">
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {FILTER_TABS.map(({ label, value, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  filter === value
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-white/[0.02] border-white/5 text-foreground/50 hover:text-foreground hover:bg-white/[0.05]"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Error state */}
          {error && (
            <div className="text-center py-12 text-red-400">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-60" />
              <p className="text-sm">{error}</p>
              <button
                onClick={() => fetchSubmissions(filter === "ALL" ? undefined : filter)}
                className="mt-3 px-4 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading state */}
          {isLoading && !error && (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && submissions.length === 0 && (
            <div className="text-center py-16 text-foreground/40">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No submissions found for this filter.</p>
            </div>
          )}

          {/* Submission list */}
          {!isLoading && !error && submissions.length > 0 && (
            <div className="space-y-4">
              {submissions.map((s) => {
                const style = STATUS_STYLES[s.status];
                return (
                  <Link
                    key={s.projectId}
                    href={`/review/${s.projectId}`}
                    className="group block rounded-2xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.05] transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-foreground/30 text-xs font-mono">
                            #{s.projectId}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.bg} ${style.color} ${style.border}`}
                          >
                            {STATUS_LABELS[s.status]}
                          </span>
                        </div>
                        <p className="font-semibold text-base truncate">{s.title}</p>
                        <p className="text-foreground/40 text-xs mt-1 font-mono truncate max-w-md">
                          {s.creatorPublicKey}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-foreground/30 text-xs">
                          {formatDate(s.updatedAt)}
                        </span>
                        <ChevronRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/50 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>

                    {s.reviewNote && (
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <p className="text-xs text-foreground/40 line-clamp-2">
                          <span className="font-medium text-foreground/50">
                            {s.reviewerId}:
                          </span>{" "}
                          {s.reviewNote}
                        </p>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
