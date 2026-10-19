"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ListErrorProps {
  /** Error message to display */
  message: string;
  /** Optional retry callback */
  onRetry?: () => void;
  /** Additional class names for the container */
  className?: string;
}

export function ListError({ message, onRetry, className }: ListErrorProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center",
        className
      )}
    >
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
        <AlertCircle className="w-6 h-6 text-red-400" />
      </div>
      <h3 className="text-sm font-semibold text-foreground/70 mb-1">
        Something went wrong
      </h3>
      <p className="text-sm text-foreground/40 max-w-sm leading-relaxed mb-4">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 text-foreground/60 text-sm font-semibold rounded-lg border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try again
        </button>
      )}
    </div>
  );
}
