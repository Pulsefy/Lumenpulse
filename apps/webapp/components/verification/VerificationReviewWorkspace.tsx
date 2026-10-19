"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardCheck, Lock, RefreshCw, Vote } from "lucide-react";
import { canViewReviewMetrics, getCurrentUserRole, type UserRole } from "@/lib/auth-role";
import {
  REVIEWER_TRANSITIONS,
  REVIEW_NOTE_MAX_LENGTH,
  requiresRationale,
  type ProjectVoteState,
  type VerificationDecision,
  type VerificationRequest,
  type VerificationRequestStatus,
} from "@/lib/verification-request-service";
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVerificationQueue,
  type QueueFilter,
} from "@/hooks/useVerificationQueue";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { EvidenceText } from "./EvidenceText";

const STATUS_LABELS: Record<VerificationRequestStatus, string> = {
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STATUS_STYLES: Record<VerificationRequestStatus, string> = {
  SUBMITTED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  IN_REVIEW: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  CHANGES_REQUESTED: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  REJECTED: "border-red-500/30 bg-red-500/10 text-red-400",
  CANCELLED: "border-white/10 bg-white/5 text-foreground/40",
};

/** Button label for each decision a reviewer can make. */
const DECISION_LABELS: Partial<Record<VerificationRequestStatus, string>> = {
  IN_REVIEW: "Start review",
  CHANGES_REQUESTED: "Request changes",
  APPROVED: "Approve",
  REJECTED: "Reject",
};

const FILTERS: { label: string; value: QueueFilter }[] = [
  { label: "Pending", value: "OPEN" },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "In review", value: "IN_REVIEW" },
  { label: "Changes requested", value: "CHANGES_REQUESTED" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "All", value: "ALL" },
];

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function StatusPill({ status }: { status: VerificationRequestStatus }) {
  return (
    <span
      data-testid="request-status"
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function VoteStateSummary({
  request,
  voteState,
}: {
  request: VerificationRequest;
  voteState: ProjectVoteState | null | undefined;
}) {
  let body: ReactNode;
  if (request.targetType !== "PROJECT") {
    body = <span>Contributor requests have no community vote.</span>;
  } else if (voteState === undefined) {
    body = <span>Loading vote state…</span>;
  } else if (voteState === null) {
    body = <span>Project is not in the on-chain registry, so there is no vote yet.</span>;
  } else {
    body = (
      <span>
        <span className="text-emerald-400 font-semibold">{voteState.votesFor}</span> for ·{" "}
        <span className="text-red-400 font-semibold">{voteState.votesAgainst}</span> against ·{" "}
        {Math.round(voteState.quorumProgress)}% of quorum · registry status{" "}
        <span className="font-semibold text-foreground/80">{voteState.status}</span>
      </span>
    );
  }
  return (
    <div className="flex items-start gap-2 text-xs text-foreground/50" data-testid="vote-state">
      <Vote className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      {body}
    </div>
  );
}

function DecisionForm({
  request,
  isDeciding,
  onDecide,
}: {
  request: VerificationRequest;
  isDeciding: boolean;
  onDecide: (decision: VerificationDecision) => Promise<void>;
}) {
  const options = REVIEWER_TRANSITIONS[request.status] ?? [];
  const [decision, setDecision] = useState<VerificationRequestStatus | null>(
    options.length === 1 ? options[0] : null,
  );
  const [rationale, setRationale] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const fieldId = useId();

  // A transition (ours or another reviewer's) changes the available decisions.
  useEffect(() => {
    setDecision(options.length === 1 ? options[0] : null);
    setRationale("");
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.status]);

  if (options.length === 0) {
    return <p className="text-xs text-foreground/40">No further reviewer action is possible.</p>;
  }

  const rationaleRequired = decision !== null && requiresRationale(decision);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!decision) {
      setFormError("Choose a decision.");
      return;
    }
    if (rationaleRequired && !rationale.trim()) {
      setFormError("Add a rationale for this decision.");
      return;
    }
    setFormError(null);
    try {
      await onDecide({ status: decision, reviewNote: rationale });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to record decision.");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-white/5 pt-4" aria-label="Record decision">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Decision</legend>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={decision === option}
            onClick={() => setDecision(option)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              decision === option
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-white/[0.02] border-white/10 text-foreground/60 hover:text-foreground hover:bg-white/[0.05]"
            }`}
          >
            {DECISION_LABELS[option] ?? STATUS_LABELS[option]}
          </button>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={fieldId} className="text-xs text-foreground/50">
          Rationale{rationaleRequired ? " (required)" : " (optional)"}
        </label>
        <textarea
          id={fieldId}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          maxLength={REVIEW_NOTE_MAX_LENGTH}
          rows={3}
          aria-required={rationaleRequired}
          placeholder="Explain the decision. The requester sees this note."
          className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {formError && (
        <p role="alert" className="text-xs text-red-400">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isDeciding}
        aria-busy={isDeciding}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
      >
        {isDeciding ? "Recording…" : "Record decision"}
      </button>
    </form>
  );
}

function RequestCard({
  request,
  voteState,
  isDeciding,
  onDecide,
}: {
  request: VerificationRequest;
  voteState: ProjectVoteState | null | undefined;
  isDeciding: boolean;
  onDecide: (decision: VerificationDecision) => Promise<void>;
}) {
  return (
    <article
      aria-label={`${request.targetType} ${request.targetId}`}
      className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-4"
    >
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-foreground/40">{request.targetType}</p>
          <p className="font-semibold font-mono break-all">{request.targetId}</p>
          <p className="text-xs text-foreground/40 mt-0.5">Submitted {formatDate(request.createdAt)}</p>
        </div>
        <StatusPill status={request.status} />
      </header>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold text-foreground/50">Evidence</h3>
        <EvidenceText evidence={request.evidence} />
      </section>

      {request.requesterNote && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold text-foreground/50">Requester note</h3>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground/70">{request.requesterNote}</p>
        </section>
      )}

      <VoteStateSummary request={request} voteState={voteState} />

      {request.reviewNote && (
        <section className="space-y-1 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <h3 className="text-xs font-semibold text-foreground/50">
            Last review note · {formatDate(request.reviewedAt)}
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground/70">{request.reviewNote}</p>
        </section>
      )}

      <DecisionForm request={request} isDeciding={isDeciding} onDecide={onDecide} />
    </article>
  );
}

interface VerificationReviewWorkspaceProps {
  /** Injected for tests; defaults to the role in the auth-token JWT. */
  role?: UserRole | null;
  /** 0 disables background refresh. */
  pollIntervalMs?: number;
}

export function VerificationReviewWorkspace({
  role: roleProp,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: VerificationReviewWorkspaceProps) {
  const [role, setRole] = useState<UserRole | null | undefined>(roleProp);
  const [filter, setFilter] = useState<QueueFilter>("OPEN");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (roleProp === undefined) setRole(getCurrentUserRole());
    else setRole(roleProp);
  }, [roleProp]);

  const allowed = role !== undefined && canViewReviewMetrics(role);
  const queue = useVerificationQueue({ enabled: allowed, filter, pollIntervalMs });

  if (role === undefined) return null;

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center space-y-3">
        <Lock className="w-8 h-8 mx-auto text-foreground/30" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Reviewer access required</h2>
        <p className="text-sm text-foreground/50">
          Only reviewers and admins can review verification requests.
        </p>
        <Link href="/verification" className="inline-block text-sm text-primary underline">
          Back to verification
        </Link>
      </div>
    );
  }

  const handleDecide = async (request: VerificationRequest, decision: VerificationDecision) => {
    const updated = await queue.decide(request.id, decision);
    setAnnouncement(
      `${request.targetType} ${request.targetId} is now ${STATUS_LABELS[updated.status].toLowerCase()}.`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
          {FILTERS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                filter === value
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-white/[0.02] border-white/5 text-foreground/50 hover:text-foreground hover:bg-white/[0.05]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground/40">
          {queue.lastUpdated && (
            <span>
              Updated {queue.lastUpdated.toLocaleTimeString()}
              {pollIntervalMs > 0 ? " · refreshes automatically" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => void queue.refresh()}
            aria-label="Refresh verification requests"
            className="p-1.5 rounded-md border border-white/10 text-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${queue.isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-emerald-400 min-h-[1.25rem]">
        {announcement}
      </p>

      {queue.isLoading && queue.requests.length === 0 ? (
        <ListSkeleton count={3} rowHeight={180} />
      ) : queue.error && queue.requests.length === 0 ? (
        <ListError message={queue.error} onRetry={() => void queue.refresh()} />
      ) : queue.requests.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No verification requests here"
          description={
            filter === "OPEN"
              ? "Nothing is waiting for review right now."
              : "No requests match this filter."
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.error && (
            <p className="text-xs text-foreground/40">
              Could not refresh just now ({queue.error}). Showing the last loaded queue.
            </p>
          )}
          {queue.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              voteState={
                request.targetType === "PROJECT" ? queue.voteStates[request.targetId] : null
              }
              isDeciding={queue.decidingId === request.id}
              onDecide={(decision) => handleDecide(request, decision)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
