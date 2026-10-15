"use client";

import { Flag } from "lucide-react";
import { useState } from "react";
import { ReportDialog } from "./report-dialog";
import type { ReportTargetType } from "@/lib/moderation-service";

export interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  targetLabel: string;
  /** "icon" for a compact circular icon button (e.g. overlaid on a card),
   *  "text" for an inline "Report" link with label. Defaults to "icon". */
  variant?: "icon" | "text";
  className?: string;
}

/**
 * Entry point for flagging a project or piece of content as suspicious or
 * inappropriate. Drop this into any card/row; it manages its own dialog
 * state so multiple instances (e.g. one per list item) don't collide.
 */
export function ReportButton({
  targetType,
  targetId,
  targetLabel,
  variant = "icon",
  className = "",
}: ReportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const open = (e: React.MouseEvent) => {
    // Report triggers commonly sit inside clickable cards/rows/links;
    // never let opening the dialog also trigger the parent's navigation.
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  };

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={open}
          aria-label={`Report ${targetLabel}`}
          title="Report"
          className={`p-2 rounded-full bg-black/40 text-white/60 hover:bg-red-500/20 hover:text-red-400 transition-colors backdrop-blur-md ${className}`}
        >
          <Flag className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-red-400 transition-colors ${className}`}
        >
          <Flag className="w-3.5 h-3.5" />
          Report
        </button>
      )}

      <ReportDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        targetType={targetType}
        targetId={targetId}
        targetLabel={targetLabel}
      />
    </>
  );
}
