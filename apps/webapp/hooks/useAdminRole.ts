"use client";

import { useCallback, useEffect, useState } from "react";
import { clientConfig } from "@/lib/config";

export type AdminRole = "user" | "reviewer" | "admin";

const AUTHORIZED_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>(["admin"]);

const SESSION_STORAGE_KEY = "lumenpulse:admin-role";
const SESSION_RESOLVED_KEY = "lumenpulse:admin-role-resolved";

interface RoleResolutionState {
  role: AdminRole | null;
  resolved: boolean;
  loading: boolean;
  error: string | null;
}

interface CachedRole {
  role: AdminRole | null;
  cachedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

function hasAuthToken(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith("auth-token="));
}

function readSessionCache(): CachedRole | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRole;
    if (typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(role: AdminRole | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const entry: CachedRole = { role, cachedAt: Date.now() };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entry));
    sessionStorage.setItem(SESSION_RESOLVED_KEY, "1");
  } catch {
    // ignore quota / serialization errors
  }
}

let inFlightPromise: Promise<AdminRole | null> | null = null;

async function resolveRoleFromBackend(): Promise<AdminRole | null> {
  const apiBase = clientConfig.apiUrl;
  const response = await fetch(`${apiBase}/users/me`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Role resolution failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { role?: AdminRole };
  const role = data.role ?? null;
  return role;
}

export interface UseAdminRoleResult {
  role: AdminRole | null;
  isAdmin: boolean;
  loading: boolean;
  resolved: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAdminRole(): UseAdminRoleResult {
  const [state, setState] = useState<RoleResolutionState>(() => {
    const cached = readSessionCache();
    if (cached) {
      return {
        role: cached.role,
        resolved: true,
        loading: false,
        error: null,
      };
    }
    return {
      role: null,
      resolved: false,
      loading: true,
      error: null,
    };
  });

  const resolveRole = useCallback(async (force = false) => {
    if (!hasAuthToken()) {
      setState({
        role: null,
        resolved: true,
        loading: false,
        error: null,
      });
      return;
    }

    if (!force) {
      const cached = readSessionCache();
      if (cached) {
        setState({
          role: cached.role,
          resolved: true,
          loading: false,
          error: null,
        });
        return;
      }
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      if (!inFlightPromise) {
        inFlightPromise = resolveRoleFromBackend();
      }
      const role = await inFlightPromise;

      // On resolution failure (e.g. unknown role value), degrade to deny.
      const normalizedRole =
        role === "admin" || role === "reviewer" || role === "user" ? role : null;

      writeSessionCache(normalizedRole);

      setState({
        role: normalizedRole,
        resolved: true,
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Role resolution failed";
      // Fail-to-deny: clear cache and treat as no admin role.
      writeSessionCache(null);
      setState({
        role: null,
        resolved: true,
        loading: false,
        error: message,
      });
    } finally {
      inFlightPromise = null;
    }
  }, []);

  useEffect(() => {
    void resolveRole(false);
  }, [resolveRole]);

  const refresh = useCallback(async () => {
    await resolveRole(true);
  }, [resolveRole]);

  const isAdmin = state.resolved ? AUTHORIZED_ROLES.has(state.role as AdminRole) : false;

  return {
    role: state.role,
    isAdmin,
    loading: state.loading,
    resolved: state.resolved,
    error: state.error,
    refresh,
  };
}
