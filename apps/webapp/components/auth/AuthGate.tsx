"use client";

import { ReactNode } from "react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

type Props = {
  children: ReactNode;
};

export default function AuthGate({ children }: Props) {
  const { loading, isAuthenticated } = useAuthGuard();

  if (loading) {
    return <div className="p-6 text-center">Checking authentication...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
