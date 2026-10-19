"use client";

import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Icon component from lucide-react */
  icon?: LucideIcon;
  /** Primary heading text */
  title: string;
  /** Secondary descriptive text */
  description?: string;
  /** Optional primary action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional class names for the container */
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center",
        className
      )}
    >
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center mb-4">
          <Icon className="w-7 h-7 text-foreground/30" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground/70 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-foreground/40 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-primary/10 text-primary text-sm font-semibold rounded-lg border border-primary/20 hover:bg-primary/20 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
