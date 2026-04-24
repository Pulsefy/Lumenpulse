"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

function hasAuthToken() {
  if (typeof document === "undefined") return false;

  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith("auth-token="));
}

export function useAuthGuard(redirectTo = "/auth/login") {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const isAuthed = hasAuthToken();

    if (!isAuthed) {
      const callbackUrl = pathname || "/";
      router.replace(
        `${redirectTo}?callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
      setLoading(false);
      return;
    }

    setIsAuthenticated(true);
    setLoading(false);
  }, [router, pathname, redirectTo]);

  return { loading, isAuthenticated };
}
