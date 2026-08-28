import { cn } from "@/lib/utils";

interface ListSkeletonProps {
  /** Number of skeleton rows to render */
  count?: number;
  /** Height of each skeleton row in pixels */
  rowHeight?: number;
  /** Additional class names for the container */
  className?: string;
  /** Variant: "list" for single-column rows, "grid" for card grid */
  variant?: "list" | "grid";
  /** Number of columns for grid variant */
  gridCols?: number;
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-white/5 animate-pulse",
        className
      )}
    />
  );
}

export function ListSkeleton({
  count = 5,
  rowHeight = 64,
  className,
  variant = "list",
  gridCols = 3,
}: ListSkeletonProps) {
  if (variant === "grid") {
    return (
      <div
        className={cn(
          "grid gap-4",
          gridCols === 2 && "grid-cols-1 md:grid-cols-2",
          gridCols === 3 && "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
          className
        )}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <SkeletonBar className="h-4 w-2/3" />
              <SkeletonBar className="h-5 w-16 rounded-full" />
            </div>
            <SkeletonBar className="h-2 w-full" />
            <div className="flex items-center justify-between">
              <SkeletonBar className="h-3 w-1/3" />
              <SkeletonBar className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.02]"
          style={{ height: rowHeight }}
        >
          <SkeletonBar className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBar className="h-3 w-1/3" />
            <SkeletonBar className="h-2 w-2/3" />
          </div>
          <SkeletonBar className="h-4 w-12 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}
