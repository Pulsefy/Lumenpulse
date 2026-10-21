import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import FeatureFlagsConsoleClient from "./FeatureFlagsConsoleClient";
import type { FeatureFlag } from "@/lib/feature-flags-service";

const getCurrentUserRole = vi.fn();
vi.mock("@/lib/auth-role", () => ({
  getCurrentUserRole: () => getCurrentUserRole(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const listFlags = vi.fn();
const getHistory = vi.fn();
const updateFlag = vi.fn();
vi.mock("@/lib/feature-flags-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags-service")>(
    "@/lib/feature-flags-service",
  );
  return {
    ...actual,
    FeatureFlagsApiService: {
      listFlags: () => listFlags(),
      getHistory: (key: string) => getHistory(key),
      updateFlag: (...args: unknown[]) => updateFlag(...args),
    },
  };
});

const flag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  key: "new-onboarding",
  enabled: false,
  sensitive: false,
  rolloutPercentage: null,
  allowList: null,
  denyList: null,
  conditions: null,
  changedBy: "alice@test.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

const rowFor = async (key: string) => screen.findByRole("listitem", { name: `Feature flag ${key}` });

describe("FeatureFlagsConsoleClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserRole.mockReturnValue("admin");
  });

  it("blocks non-admins and never requests flags", async () => {
    getCurrentUserRole.mockReturnValue("user");
    render(<FeatureFlagsConsoleClient />);

    expect(await screen.findByText(/admin access required/i)).toBeInTheDocument();
    expect(listFlags).not.toHaveBeenCalled();
  });

  it("lists every flag with its state, targeting rule and last change", async () => {
    listFlags.mockResolvedValue([
      flag(),
      flag({ key: "payments", enabled: true, rolloutPercentage: 25, sensitive: true }),
    ]);
    render(<FeatureFlagsConsoleClient />);

    const plain = await rowFor("new-onboarding");
    expect(within(plain).getByText("OFF")).toBeInTheDocument();
    expect(within(plain).getByTestId("targeting-rule")).toHaveTextContent("Off for everyone");
    const lastChange = within(plain).getByTestId("last-change");
    expect(lastChange).toHaveTextContent(/Last changed .+ by alice@test\.com/);
    expect(lastChange.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-02-01T00:00:00.000Z",
    );

    const sensitive = await rowFor("payments");
    expect(within(sensitive).getByText("SENSITIVE")).toBeInTheDocument();
    expect(within(sensitive).getByTestId("targeting-rule")).toHaveTextContent("Rollout 25% of users");
  });

  it("toggles a non-sensitive flag immediately", async () => {
    listFlags.mockResolvedValue([flag()]);
    updateFlag.mockResolvedValue(flag({ enabled: true }));
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("switch", { name: "Toggle new-onboarding" }));

    await waitFor(() =>
      expect(updateFlag).toHaveBeenCalledWith(
        expect.objectContaining({ key: "new-onboarding" }),
        { enabled: true },
        { confirm: false },
      ),
    );
    expect(await screen.findByRole("switch", { name: "Toggle new-onboarding" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("adjusts the rollout percentage", async () => {
    listFlags.mockResolvedValue([flag()]);
    updateFlag.mockResolvedValue(flag({ rolloutPercentage: 40 }));
    render(<FeatureFlagsConsoleClient />);

    fireEvent.change(await screen.findByLabelText("Rollout percentage for new-onboarding"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply rollout" }));

    await waitFor(() =>
      expect(updateFlag).toHaveBeenCalledWith(
        expect.anything(),
        { rolloutPercentage: 40 },
        { confirm: false },
      ),
    );
  });

  it("rejects an out-of-range percentage without calling the API", async () => {
    listFlags.mockResolvedValue([flag()]);
    render(<FeatureFlagsConsoleClient />);

    fireEvent.change(await screen.findByLabelText("Rollout percentage for new-onboarding"), {
      target: { value: "150" },
    });

    expect(screen.getByRole("button", { name: "Apply rollout" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/0 to 100/);
    expect(updateFlag).not.toHaveBeenCalled();
  });

  it("requires typing the key before changing a sensitive flag", async () => {
    listFlags.mockResolvedValue([flag({ key: "payments", sensitive: true })]);
    updateFlag.mockResolvedValue(flag({ key: "payments", sensitive: true, enabled: true }));
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("switch", { name: "Toggle payments" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(updateFlag).not.toHaveBeenCalled();
    const confirmButton = within(dialog).getByRole("button", { name: "Confirm change" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "payments" } });
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(updateFlag).toHaveBeenCalledWith(
        expect.objectContaining({ key: "payments" }),
        { enabled: true },
        { confirm: true },
      ),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancelling the confirmation applies nothing", async () => {
    listFlags.mockResolvedValue([flag({ key: "payments", sensitive: true })]);
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("switch", { name: "Toggle payments" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(updateFlag).not.toHaveBeenCalled();
  });

  it("opens the confirmation when the server reports the flag became sensitive", async () => {
    const { SensitiveConfirmationRequiredError } = await import("@/lib/feature-flags-service");
    listFlags.mockResolvedValue([flag()]);
    updateFlag.mockRejectedValueOnce(new SensitiveConfirmationRequiredError("needs confirm"));
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("switch", { name: "Toggle new-onboarding" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows per-flag history with actor and timestamp", async () => {
    listFlags.mockResolvedValue([flag()]);
    getHistory.mockResolvedValue([
      {
        id: "a1",
        flagKey: "new-onboarding",
        action: "upsert",
        previousEnabled: false,
        newEnabled: true,
        previousTargeting: { rolloutPercentage: null, allowList: [], denyList: [] },
        newTargeting: { rolloutPercentage: null, allowList: [], denyList: [] },
        actor: "bob@test.com",
        changedAt: "2026-03-01T10:00:00.000Z",
      },
    ]);
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("button", { name: /show history/i }));

    const history = await screen.findByRole("list", { name: "Change history for new-onboarding" });
    expect(within(history).getByText("off → on")).toBeInTheDocument();
    expect(within(history).getByText("bob@test.com")).toBeInTheDocument();
    expect(history.querySelector("time")).toHaveAttribute("dateTime", "2026-03-01T10:00:00.000Z");
    expect(getHistory).toHaveBeenCalledWith("new-onboarding");
  });

  it("surfaces load errors with a retry", async () => {
    listFlags.mockRejectedValueOnce(new Error("Admin access is required to manage feature flags."));
    listFlags.mockResolvedValueOnce([flag()]);
    render(<FeatureFlagsConsoleClient />);

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(await rowFor("new-onboarding")).toBeInTheDocument();
  });
});
