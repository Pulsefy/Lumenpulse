"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, Clock, Users } from "lucide-react";
import { VerificationBadge } from "@/components/verification-badge";

type Status = "PENDING" | "VERIFIED" | "REJECTED";

interface ProjectVerification {
  projectId: number;
  name: string;
  ownerPublicKey: string;
  status: Status;
  votesFor: number;
  votesAgainst: number;
  registeredAt: number;
  resolvedAt: number;
  quorumProgress: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const FILTER_TABS: { label: string; value: Status | "ALL"; icon: typeof ShieldCheck }[] = [
  { label: "All", value: "ALL", icon: Users },
  { label: "Pending", value: "PENDING", icon: Clock },
  { label: "Verified", value: "VERIFIED", icon: ShieldCheck },
  { label: "Rejected", value: "REJECTED", icon: ShieldAlert },
];

export default function VerificationPage() {
  const [projects, setProjects] = useState<ProjectVerification[]>([]);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [votingId, setVotingId] = useState<number | null>(null);

  const fetchProjects = (status?: Status) => {
    setIsLoading(true);
    const qs = status ? `?status=${status}` : "";
    fetch(`${API_BASE}/verification/projects${qs}`)
      .then((r) => r.json())
      .then((data: ProjectVerification[]) => setProjects(data))
      .catch(() => setProjects([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchProjects(filter === "ALL" ? undefined : filter);
  }, [filter]);

  const handleVote = async (projectId: number, support: boolean) => {
    setVotingId(projectId);
    try {
      const res = await fetch(`${API_BASE}/verification/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, voterPublicKey: "DEMO_VOTER", support }),
      });
      if (res.ok) {
        fetchProjects(filter === "ALL" ? undefined : filter);
      }
    } finally {
      setVotingId(null);
    }
  };

  const counts = {
    PENDING: projects.filter((p) => p.status === "PENDING").length,
    VERIFIED: projects.filter((p) => p.status === "VERIFIED").length,
    REJECTED: projects.filter((p) => p.status === "REJECTED").length,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Verification</h1>
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            The community decides which projects earn{" "}
            <span className="text-primary font-semibold">Lumenpulse Verified</span> status and
            become eligible for matching funds. Voting weight is determined by your reputation score
            or governance token balance.
          </p>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Pending", count: counts.PENDING, color: "text-amber-400" },
              { label: "Verified", count: counts.VERIFIED, color: "text-emerald-400" },
              { label: "Rejected", count: counts.REJECTED, color: "text-red-400" },
            ].map(({ label, count, color }) => (
              <div
                key={label}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center"
              >
                <p className={`text-2xl font-bold ${color}`}>{count}</p>
                <p className="text-foreground/40 text-xs mt-1">{label}</p>
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

          {/* Project list */}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-16 text-foreground/40">
              <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No projects found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map((p) => (
                <div
                  key={p.projectId}
                  className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-foreground/40 text-xs mt-0.5 font-mono truncate max-w-xs">
                        {p.ownerPublicKey}
                      </p>
                    </div>
                    <span className="text-foreground/30 text-xs">#{p.projectId}</span>
                  </div>

                  <VerificationBadge
                    status={p.status}
                    votesFor={p.votesFor}
                    votesAgainst={p.votesAgainst}
                    quorumProgress={p.quorumProgress}
                    canVote={p.status === "PENDING"}
                    isVoting={votingId === p.projectId}
                    onVote={(support) => void handleVote(p.projectId, support)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
