"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ModerationApiService,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_REASON_OPTIONS,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/moderation-service";

export interface ReportDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Type of content being reported, aligned with the backend's ReportType enum. */
  targetType: ReportTargetType;
  /** ID of the project, news item, comment, etc. being reported. */
  targetId: string;
  /** Human-readable label used in the dialog copy, e.g. "Project #12" or the article title. */
  targetLabel: string;
}

type SubmitState = "idle" | "submitting" | "success" | "error";

export function ReportDialog({
  isOpen,
  onOpenChange,
  targetType,
  targetId,
  targetLabel,
}: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset the form each time the dialog is (re)opened so a previous
  // submission doesn't linger when reporting a different item.
  useEffect(() => {
    if (isOpen) {
      setReason(null);
      setDescription("");
      setState("idle");
      setErrorMessage(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || state === "submitting") return;

    setState("submitting");
    setErrorMessage(null);

    try {
      await ModerationApiService.submitReport({
        targetType,
        targetId,
        reason,
        description: description.trim() ? description.trim() : undefined,
      });
      setState("success");
    } catch (err: any) {
      setErrorMessage(
        err?.message ?? "Failed to submit report. Please try again.",
      );
      setState("error");
    }
  };

  const canSubmit = !!reason && state !== "submitting";

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-zinc-950 p-6 shadow-xl sm:rounded-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => {
            // Avoid autofocus landing on the close button; let the first
            // reason option receive focus instead for keyboard users.
            if (state === "success") e.preventDefault();
          }}
        >
          {state === "success" ? (
            <div className="flex flex-col items-center gap-4 text-center py-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                <Check className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <Dialog.Title className="text-xl font-semibold text-white">
                  Report submitted
                </Dialog.Title>
                <Dialog.Description className="text-sm text-zinc-400">
                  Thanks for flagging this. Our moderation team will review it
                  shortly.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-black transition-colors hover:bg-primary/90 focus:outline-none">
                  Done
                </button>
              </Dialog.Close>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="space-y-1 pr-6">
                <Dialog.Title className="text-lg font-semibold text-white">
                  Report {targetLabel}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-zinc-400">
                  Let us know what&apos;s wrong. Reports are sent to our
                  moderation queue for review.
                </Dialog.Description>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Category
                </span>
                <div className="flex flex-wrap gap-2">
                  {REPORT_REASON_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReason(option.value)}
                      aria-pressed={reason === option.value}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        reason === option.value
                          ? "bg-primary/20 border-primary/40 text-primary"
                          : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="report-description"
                  className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  Additional details{" "}
                  <span className="normal-case font-normal text-zinc-600">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="report-description"
                  value={description}
                  onChange={(e) =>
                    setDescription(
                      e.target.value.slice(0, REPORT_DESCRIPTION_MAX_LENGTH),
                    )
                  }
                  rows={3}
                  maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
                  placeholder="Anything that would help our reviewers, e.g. links or specific concerns."
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="text-right text-[11px] text-zinc-600">
                  {description.length}/{REPORT_DESCRIPTION_MAX_LENGTH}
                </div>
              </div>

              {state === "error" && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-white/10 px-4 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/5 focus:outline-none"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-black transition-colors hover:bg-primary/90 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state === "submitting" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {state === "submitting" ? "Submitting..." : "Submit report"}
                </button>
              </div>
            </form>
          )}

          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
