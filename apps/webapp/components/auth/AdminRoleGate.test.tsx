import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AdminRoleGate from "./AdminRoleGate";

vi.mock("@/hooks/useAdminRole", () => ({
  useAdminRole: vi.fn(),
}));

import { useAdminRole } from "@/hooks/useAdminRole";
const mockedUseAdminRole = vi.mocked(useAdminRole);

describe("AdminRoleGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("authorized user (confirmed admin)", () => {
    beforeEach(() => {
      mockedUseAdminRole.mockReturnValue({
        role: "admin",
        isAdmin: true,
        loading: false,
        resolved: true,
        error: null,
        refresh: vi.fn(),
      });
    });

    it("renders children when user is confirmed admin", () => {
      render(
        <AdminRoleGate>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
    });
  });

  describe("unauthorized user (non-admin, role resolved)", () => {
    beforeEach(() => {
      mockedUseAdminRole.mockReturnValue({
        role: "user",
        isAdmin: false,
        loading: false,
        resolved: true,
        error: null,
        refresh: vi.fn(),
      });
    });

    it("renders default ForbiddenView fallback when forbiddenFallback is not provided", () => {
      render(
        <AdminRoleGate>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /access denied/i })).toBeInTheDocument();
      expect(
        screen.getByText(/you do not have permission/i),
      ).toBeInTheDocument();
    });

    it("renders custom forbiddenFallback when provided", () => {
      render(
        <AdminRoleGate forbiddenFallback={<div data-testid="custom-403">No access</div>}>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(screen.getByTestId("custom-403")).toBeInTheDocument();
    });

    it("renders nothing when forbiddenFallback=null (for nav entries that must hide)", () => {
      const { container } = render(
        <AdminRoleGate forbiddenFallback={null}>
          <a href="/admin" data-testid="admin-link">
            Admin
          </a>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("admin-link")).not.toBeInTheDocument();
      expect(container.textContent).toBe("");
    });
  });

  describe("role-unknown / still loading / resolution failed (role not resolved)", () => {
    it("renders default loadingFallback=null (nothing) while role is still loading", () => {
      mockedUseAdminRole.mockReturnValue({
        role: null,
        isAdmin: false,
        loading: true,
        resolved: false,
        error: null,
        refresh: vi.fn(),
      });

      const { container } = render(
        <AdminRoleGate>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(container.textContent).toBe("");
    });

    it("renders loadingFallback when explicitly provided and role is loading", () => {
      mockedUseAdminRole.mockReturnValue({
        role: null,
        isAdmin: false,
        loading: true,
        resolved: false,
        error: null,
        refresh: vi.fn(),
      });

      render(
        <AdminRoleGate loadingFallback={<div data-testid="loader">Checking access...</div>}>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.getByTestId("loader")).toBeInTheDocument();
      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    });

    it("hides admin surfaces when resolved=false (role-unknown), i.e. advertises nothing", () => {
      // resolved=false AND loading=false: a theoretical mid-state where role not confirmed
      // The gate must still not show children.
      mockedUseAdminRole.mockReturnValue({
        role: null,
        isAdmin: false,
        loading: false,
        resolved: false,
        error: null,
        refresh: vi.fn(),
      });

      const { container } = render(
        <AdminRoleGate>
          <div data-testid="child">Admin content</div>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
      expect(container.textContent).toBe("");
    });

    it("hides admin surfaces when role resolution failed (fail-to-deny behavior)", () => {
      // When hook fails: resolved=true, role=null, isAdmin=false, error set
      // For nav entries with forbiddenFallback=null: nothing renders
      mockedUseAdminRole.mockReturnValue({
        role: null,
        isAdmin: false,
        loading: false,
        resolved: true,
        error: "500 Internal Server Error",
        refresh: vi.fn(),
      });

      const { container } = render(
        <AdminRoleGate forbiddenFallback={null}>
          <a href="/admin" data-testid="admin-link">
            Admin
          </a>
        </AdminRoleGate>,
      );

      expect(screen.queryByTestId("admin-link")).not.toBeInTheDocument();
      expect(container.textContent).toBe("");
    });
  });
});
