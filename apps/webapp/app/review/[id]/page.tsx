"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Clock,
  FileText,
  AlertTriangle,
  Lock,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Eye,
  User,
  Copy,
} from "lucide-react";
import { SubmissionApiService } from "@/lib/submission-service";
import type { ProjectSubmission, SubmissionStatus, DecisionEntry } from "@/types/submission";

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
  return new Date(timestamp * 1000).toLocaleString();
}

function ActionModal({
  open,
  onClose,
  onSubmit,
  title,
  placeholder,
  submitLabel,
  defaultNote,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  title: string;
  placeholder: string;
  submitLabel: string;
  defaultNote?: string;
}) {
  const [note, setNote] = useState(defaultNote || "");

  useEffect(() => {
    setNote(defaultNote || "");
  }, [defaultNote, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-6 space-y-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="w-full rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary/50 focus:outline-none resize-none"
        />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-white/10 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(note)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = Number(params.id);

  const [submission, setSubmission] = useState<ProjectSubmission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [history, setHistory] = useState<DecisionEntry[]>([]);
  const [modal, setModal] = useState<{
    open: boolean;
    type: "request_changes" | "approve" | "reject" | "publish";
  } | null>(null);

  useEffect(() => {
    setIsAuthed(hasAuthToken());
  }, []);

  useEffect(() => {
    if (!projectId || Number.isNaN(projectId)) {
      setError("Invalid submission ID");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    SubmissionApiService.getSubmission(projectId)
      .then((data) => {
        setSubmission(data);
        const initial: DecisionEntry[] = [];
        if (data.reviewNote) {
          initial.push({
            action: "request_changes",
            actorId: data.reviewerId || "system",
            note: data.reviewNote,
            timestamp: data.updatedAt,
          });
        }
        setHistory(initial);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load submission");
        setSubmission(null);
      })
      .finally(() => setIsLoading(false));
  }, [projectId]);

  const handleAction = async (note: string) => {
    if (!submission || !modal) return;
    setActioning(true);
    setMessage(null);

    try {
      let updated: ProjectSubmission;
      const payload = { actorId: "reviewer", note };

      switch (modal.type) {
        case "request_changes":
          updated = await SubmissionApiService.requestChanges(submission.projectId, payload);
          break;
        case "reject":
          updated = await SubmissionApiService.requestChanges(submission.projectId, {
            ...payload,
            note: note || "Rejected by reviewer.",
          });
          break;
        case "approve":
          updated = await SubmissionApiService.approve(submission.projectId, payload);
          break;
        case "publish":
          updated = await SubmissionApiService.publish(submission.projectId, payload);
          break;
      }

      setSubmission(updated);
      setHistory((prev) => [
        ...prev,
        {
          action: modal.type === "reject" ? "request_changes" : modal.type,
          actorId: payload.actorId,
          note: payload.note,
          timestamp: Date.now() / 1000,
        },
      ]);
      setMessage({ type: "success", text: "Action completed successfully." });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setActioning(false);
      setModal(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <Loader2 className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-2xl px-4 py-20">
          <Link
            href="/review"
            className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to submissions
          </Link>
          <div className="text-center py-16">
            <AlertTriangle className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
            <p className="text-foreground/40">{error || "Submission not found"}</p>
            {!isAuthed && (
              <p className="text-xs text-foreground/30 mt-2">
                You may need to sign in to view this submission.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const style = STATUS_STYLES[submission.status];
  const canAct = isAuthed && (submission.status === "IN_REVIEW" || submission.status === "APPROVED");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="pt-32 pb-8 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-3xl relative z-10">
          <Link
            href="/review"
            className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to submissions
          </Link>

          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-foreground/30 text-xs font-mono">
                  #{submission.projectId}
                </span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style.bg} ${style.color} ${style.border}`}
                >
                  {STATUS_LABELS[submission.status]}
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{submission.title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-foreground/40 mt-3">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {submission.creatorPublicKey}
            </span>
            <span>Updated {formatDate(submission.updatedAt)}</span>
            <button
              onClick={() => copyToClipboard(submission.creatorPublicKey)}
              className="hover:text-foreground/60 transition-colors"
              title="Copy public key"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-3xl space-y-6">
          {!isAuthed && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <Lock className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-400">Reviewer access required</p>
                <p className="text-xs text-foreground/50 mt-1">
                  Sign in to perform review actions.{" "}
                  <Link href="/auth/login" className="text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          )}

          {message && (
            <div
              className={`p-4 rounded-xl border ${
                message.type === "success"
                  ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                  : "border-red-500/20 bg-red-500/5 text-red-400"
              }`}
            >
              <div className="flex items-center gap-2">
                {message.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <p className="text-sm">{message.text}</p>
              </div>
            </div>
          )}

          {/* Evidence / Content */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-4">
              Submission Content
            </h2>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {submission.content}
            </p>
          </div>

          {/* Latest Review Note */}
          {submission.reviewNote && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
              <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-3">
                Latest Review Note
              </h2>
              <div className="flex items-start gap-3">
                <Eye className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-foreground/40 mb-1">
                    By {submission.reviewerId} &middot; {formatDate(submission.updatedAt)}
                  </p>
                  <p className="text-sm text-foreground/80">{submission.reviewNote}</p>
                </div>
              </div>
            </div>
          )}

          {/* Decision History */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6">
            <h2 className="text-sm font-semibold text-foreground/50 uppercase tracking-wider mb-4">
              Decision History
            </h2>
            {history.length === 0 ? (
              <p className="text-xs text-foreground/30">No decisions recorded yet.</p>
            ) : (
              <div className="space-y-4">
                {history.map((entry, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-primary/60" />
                      {idx < history.length - 1 && (
                        <div className="w-px h-full bg-white/5 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground/70 capitalize">
                          {entry.action.replace("_", " ")}
                        </span>
                        <span className="text-[10px] text-foreground/30">
                          {formatDate(entry.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground/40">
                        by {entry.actorId}
                      </p>
                      {entry.note && (
                        <p className="text-xs text-foreground/60 mt-1 italic">
                          &ldquo;{entry.note}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {canAct && (
            <div className="flex flex-wrap gap-3">
              {submission.status === "IN_REVIEW" && (
                <>
                  <button
                    onClick={() => setModal({ open: true, type: "approve" })}
                    disabled={actioning}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => setModal({ open: true, type: "request_changes" })}
                    disabled={actioning}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-orange-500/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    Request Changes
                  </button>
                  <button
                    onClick={() => setModal({ open: true, type: "reject" })}
                    disabled={actioning}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                </>
              )}
              {submission.status === "APPROVED" && (
                <button
                  onClick={() => setModal({ open: true, type: "publish" })}
                  disabled={actioning}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  Publish
                </button>
              )}
            </div>
          )}

          {/* Status-specific info */}
          {submission.status === "DRAFT" && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-white/5 bg-white/[0.02]">
              <Clock className="w-4 h-4 text-foreground/30 mt-0.5" />
              <p className="text-xs text-foreground/40">
                This submission is in draft. It has not been submitted for review yet.
              </p>
            </div>
          )}
          {submission.status === "CHANGES_REQUESTED" && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-orange-500/10 bg-orange-500/5">
              <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5" />
              <p className="text-xs text-orange-300/80">
                Waiting for the creator to revise and resubmit.
              </p>
            </div>
          )}
          {submission.status === "PUBLISHED" && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-blue-500/10 bg-blue-500/5">
              <CheckCircle2 className="w-4 h-4 text-blue-400 mt-0.5" />
              <p className="text-xs text-blue-300/80">
                This submission has been published and is visible to the public.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Action Modal */}
      <ActionModal
        open={modal?.open ?? false}
        onClose={() => setModal(null)}
        onSubmit={handleAction}
        title={
          modal?.type === "approve"
            ? "Approve Submission"
            : modal?.type === "reject"
            ? "Reject Submission"
            : modal?.type === "publish"
            ? "Publish Submission"
            : "Request Changes"
        }
        placeholder={
          modal?.type === "approve"
            ? "Add approval notes (optional)..."
            : modal?.type === "reject"
            ? "Add rejection reason..."
            : modal?.type === "publish"
            ? "Add publishing notes (optional)..."
            : "Describe the changes needed..."
        }
        submitLabel={
          modal?.type === "approve"
            ? "Approve"
            : modal?.type === "reject"
            ? "Reject"
            : modal?.type === "publish"
            ? "Publish"
            : "Request Changes"
        }
      />
    </div>
  );
}
