"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  User,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Activity,
  Coins,
  Trophy,
  ArrowRight,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import {
  ContributorApiService,
  type ContributorProfile,
  type ContributorActivity,
} from "@/lib/contributor-service";

// ── Props ────────────────────────────────────────────────────────────────────

interface ContributorProfileClientProps {
  address: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const ACTIVITY_ICON: Record<
  ContributorActivity["activityType"],
  typeof Activity
> = {
  contributor_registered: User,
  grant_contribution: Coins,
  reputation_change: Trophy,
};

const ACTIVITY_LABEL: Record<ContributorActivity["activityType"], string> = {
  contributor_registered: "Registered",
  grant_contribution: "Contribution",
  reputation_change: "Reputation",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function ContributorProfileClient({
  address,
}: ContributorProfileClientProps) {
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await ContributorApiService.getProfile(address);
        if (!cancelled) setProfile(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load contributor profile",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [address]);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in all environments
    }
  };

  // ── Loading State ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <section className="relative pt-32 pb-16 px-4">
          <div className="container mx-auto max-w-4xl relative z-10">
            <div className="animate-pulse space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/10" />
                <div className="space-y-2">
                  <div className="h-6 w-48 bg-white/10 rounded" />
                  <div className="h-4 w-32 bg-white/10 rounded" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 bg-white/5 rounded-xl border border-white/5"
                  />
                ))}
              </div>
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 bg-white/5 rounded-xl border border-white/5"
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ── Error / Not Found State ──────────────────────────────────────────────

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="text-center max-w-md space-y-4">
          <AlertCircle className="w-16 h-16 mx-auto text-foreground/20" />
          <h1 className="text-2xl font-bold">Contributor Not Found</h1>
          <p className="text-foreground/50 text-sm">
            {error ||
              "We couldn't find a contributor profile for this address."}
          </p>
          <p className="text-foreground/30 text-xs font-mono break-all">
            {address}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // ── Main Render ──────────────────────────────────────────────────────────

  const { aggregates, activities, totalActivities, isSparseContributor } =
    profile;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
              <User className="w-8 h-8 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">
                Contributor Profile
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <Wallet className="w-4 h-4 text-foreground/40" />
                <span className="text-foreground/60 text-sm font-mono truncate">
                  {shortAddress(address)}
                </span>
                <button
                  onClick={handleCopyAddress}
                  className="text-foreground/40 hover:text-foreground transition-colors"
                  aria-label="Copy address"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-3 flex-wrap">
            {isSparseContributor ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Clock className="w-3.5 h-3.5" />
                New Contributor
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                Active Contributor
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/10 border border-primary/20 text-primary">
              <Activity className="w-3.5 h-3.5" />
              {totalActivities}{" "}
              {totalActivities === 1 ? "Activity" : "Activities"}
            </span>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
                <Coins className="w-3.5 h-3.5 text-primary" />
                <span>Total Contributed</span>
              </div>
              <p className="text-2xl font-bold font-mono">
                {aggregates.totalContributed.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-sm text-foreground/40">XLM</span>
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span>Transactions</span>
              </div>
              <p className="text-2xl font-bold font-mono">
                {aggregates.transactionsCount}
              </p>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
                <Trophy className="w-3.5 h-3.5 text-primary" />
                <span>Projects Supported</span>
              </div>
              <p className="text-2xl font-bold font-mono">
                {aggregates.projectsSupported}
              </p>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Activity</h2>
              {totalActivities > 10 && (
                <span className="text-xs text-foreground/40">
                  Showing 10 of {totalActivities}
                </span>
              )}
            </div>

            {activities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
                <Activity className="w-12 h-12 mx-auto mb-3 text-foreground/20" />
                <p className="text-foreground/40 text-sm">
                  No activity recorded yet
                </p>
                <p className="text-foreground/30 text-xs mt-1">
                  Activity will appear here once the contributor participates in
                  grants or registers.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activities.map((activity) => {
                  const Icon = ACTIVITY_ICON[activity.activityType];
                  return (
                    <div
                      key={activity.id}
                      className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-start gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-primary/70 uppercase tracking-wide">
                            {ACTIVITY_LABEL[activity.activityType]}
                          </span>
                          <span className="text-xs text-foreground/30">
                            {formatDate(activity.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/80">
                          {activity.summary}
                        </p>
                        {activity.githubHandle && (
                          <p className="text-xs text-foreground/40 mt-1">
                            GitHub: @{activity.githubHandle}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verification Status Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Verification Status</h2>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              {isSparseContributor ? (
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-400">
                      Pending Review
                    </p>
                    <p className="text-xs text-foreground/50 mt-1">
                      This contributor is new and awaiting verification. More
                      activity will help establish their reputation.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">
                      Active & Verified
                    </p>
                    <p className="text-xs text-foreground/50 mt-1">
                      This contributor has established activity on the platform
                      and is considered active.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Call to Action */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
            <p className="text-sm font-semibold text-primary mb-2">
              Want to explore more contributors?
            </p>
            <Link
              href="/community"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              Visit Community Page
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
