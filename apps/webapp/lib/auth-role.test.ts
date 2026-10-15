import { describe, it, expect, afterEach } from "vitest";
import { canViewReviewMetrics, getCurrentUserRole, getRoleFromToken } from "./auth-role";

function tokenWith(claims: Record<string, unknown>): string {
  const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(claims))}.sig`;
}

afterEach(() => {
  document.cookie = "auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("auth-role", () => {
  it("reads the role claim from the JWT payload", () => {
    expect(getRoleFromToken(tokenWith({ sub: "1", role: "reviewer" }))).toBe("reviewer");
    expect(getRoleFromToken(tokenWith({ sub: "1", role: "admin" }))).toBe("admin");
  });

  it("returns null for missing, unknown or malformed tokens", () => {
    expect(getRoleFromToken(null)).toBeNull();
    expect(getRoleFromToken("not-a-jwt")).toBeNull();
    expect(getRoleFromToken("a.%%%.c")).toBeNull();
    expect(getRoleFromToken(tokenWith({ sub: "1" }))).toBeNull();
    expect(getRoleFromToken(tokenWith({ role: "superuser" }))).toBeNull();
  });

  it("reads the role from the auth-token cookie", () => {
    document.cookie = `auth-token=${tokenWith({ role: "admin" })}; path=/`;
    expect(getCurrentUserRole()).toBe("admin");
  });

  it("only allows reviewer and admin to view review metrics", () => {
    expect(canViewReviewMetrics("reviewer")).toBe(true);
    expect(canViewReviewMetrics("admin")).toBe(true);
    expect(canViewReviewMetrics("user")).toBe(false);
    expect(canViewReviewMetrics(null)).toBe(false);
  });
});
