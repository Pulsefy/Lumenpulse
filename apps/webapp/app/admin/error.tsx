"use client";

import { RouteErrorBoundary } from "@/components/route-error-boundary";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} segment="admin" />;
}
