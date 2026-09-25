"use client";

import { ReactNode } from "react";
import { useAdminRole } from "@/hooks/useAdminRole";
import { ForbiddenView } from "./ForbiddenView";

interface AdminRoleGateProps {
  children: ReactNode;
  /**
   * Behavior when role is still loading.
   * Defaults to rendering nothing (hide admin surfaces while resolving).
   */
  loadingFallback?: ReactNode;
  /**
   * Behavior when role resolution fails or user is not an admin.
   * Defaults to rendering a 403 ForbiddenView.
   * Set to `null` to silently hide (useful for navigation entries).
   */
  forbiddenFallback?: ReactNode | null;
}

export default function AdminRoleGate({
  children,
  loadingFallback = null,
  forbiddenFallback,
}: AdminRoleGateProps) {
  const { isAdmin, loading, resolved } = useAdminRole();

  if (loading || !resolved) {
    return <>{loadingFallback}</>;
  }

  if (!isAdmin) {
    if (forbiddenFallback === undefined) {
      return <ForbiddenView />;
    }
    return <>{forbiddenFallback}</>;
  }

  return <>{children}</>;
}
