// Client-side view of the signed-in user's role.
//
// The backend signs `{ email, sub, role }` into the JWT stored in the
// `auth-token` cookie (apps/backend/src/auth/auth.service.ts). We only decode
// the payload here to decide what UI to show — authorization is still
// enforced server-side by RolesGuard.

export type UserRole = "user" | "reviewer" | "admin";

export const REVIEW_ROLES: readonly UserRole[] = ["reviewer", "admin"];

export function getAuthToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("auth-token="));
  return match ? match.slice("auth-token=".length) || null : null;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

export function getRoleFromToken(token: string | null): UserRole | null {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { role?: unknown };
    const role = claims.role;
    return role === "user" || role === "reviewer" || role === "admin"
      ? role
      : null;
  } catch {
    return null;
  }
}

export function getCurrentUserRole(): UserRole | null {
  return getRoleFromToken(getAuthToken());
}

export function canViewReviewMetrics(role: UserRole | null): boolean {
  return role !== null && REVIEW_ROLES.includes(role);
}
