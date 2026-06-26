"use client";

import { ShieldCheck, ShieldAlert, Clock, ThumbsUp, ThumbsDown } from "lucide-react";

type Status = "PENDING" | "VERIFIED" | "REJECTED";

interface Props {
  status: Status;
  votesFor: number;
  votesAgainst: number;
  quorumProgress: number;
  canVote?: boolean;
  isVoting?: boolean;
  onVote?: (support: boolean) => void;
}

const STATUS_CONFIG = {
  VERIFIED: {
    icon: ShieldCheck,
    label: "Lumenpulse Verified",
    color: "text-emerald-400",
    bar: "bg-emerald-400",
    border: "border-emerald-400/20",
    bg: "bg-emerald-400/5",
  },
  REJECTED: {
    icon: ShieldAlert,
    label: "Not Verified",
    color: "text-red-400",
    bar: "bg-red-400",
    border: "border-red-400/20",
    bg: "bg-red-400/5",
  },
  PENDING: {
    icon: Clock,
    label: "Pending Review",
    color: "text-amber-400",
    bar: "bg-amber-400",
    border: "border-amber-400/20",
    bg: "bg-amber-400/5",
  },
};

export function VerificationBadge({
  status,
  votesFor,
  votesAgainst,
  quorumProgress,
  canVote = false,
  isVoting = false,
  onVote,
}: Props) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 space-y-3`}>
      {/* Status header */}
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${cfg.color}`} />
        <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
      </div>

      {/* Quorum bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-foreground/40">
          <span>Community votes</span>
          <span className={cfg.color}>{quorumProgress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full ${cfg.bar} transition-all duration-500`}
            style={{ width: `${quorumProgress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-foreground/40">
          <span className="text-emerald-400">{votesFor} for</span>
          <span className="text-red-400">{votesAgainst} against</span>
        </div>
      </div>

      {/* Vote buttons */}
      {canVote && onVote && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onVote(true)}
            disabled={isVoting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border border-emerald-400/30 bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 transition-colors disabled:opacity-50"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
            Verify
          </button>
          <button
            onClick={() => onVote(false)}
            disabled={isVoting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold border border-red-400/30 bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors disabled:opacity-50"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
