import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DependencyStatusBanner,
} from "./DependencyStatusBanner";
import { DependencyHealthReport } from "@/hooks/useDependencyHealth";

// ── Mocks ────────────────────────────────────────────────────────────────

// We use `vi.hoisted` so the mock is in scope before the component uses it.
const { mockUseStellarConfig, mockUseDependencyHealth } = vi.hoisted(() => ({
  mockUseStellarConfig: vi.fn(),
  mockUseDependencyHealth: vi.fn(),
}));

vi.mock("@/contexts/StellarConfigContext", () => ({
  useStellarConfig: () => mockUseStellarConfig(),
}));

vi.mock("@/hooks/useDependencyHealth", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useDependencyHealth")>(
      "@/hooks/useDependencyHealth",
    );
  return {
    ...actual,
    useDependencyHealth: () => mockUseDependencyHealth(),
  };
});

// ── Test fixtures ─────────────────────────────────────────────────────────

const STELLAR_NETWORK_CONFIG = {
  network: "testnet" as const,
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contracts: {
    lumenToken: null,
    crowdfundVault: null,
    projectRegistry: null,
    contributorRegistry: null,
    matchingPool: null,
    treasury: null,
  },
};

const MAINNET_NETWORK_CONFIG = {
  ...STELLAR_NETWORK_CONFIG,
  network: "mainnet" as const,
  horizonUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "https://soroban.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
};

function readyTestnetConfig() {
  return {
    config: STELLAR_NETWORK_CONFIG,
    status: "ready" as const,
    error: null,
    retry: vi.fn(),
  };
}

function readyMainnetConfig() {
  return {
    config: MAINNET_NETWORK_CONFIG,
    status: "ready" as const,
    error: null,
    retry: vi.fn(),
  };
}

function loadingConfig() {
  return {
    config: null,
    status: "loading" as const,
    error: null,
    retry: vi.fn(),
  };
}

function erroredConfig() {
  return {
    config: null,
    status: "error" as const,
    error: "boom",
    retry: vi.fn(),
  };
}

function freshHealthyReport(): DependencyHealthReport {
  return {
    overallState: "ok",
    checkedAt: new Date().toISOString(),
    horizon: { state: "ok", latencyMs: 142 },
    sorobanRpc: { state: "ok", latencyMs: 218 },
  };
}

function freshDegradedReport(): DependencyHealthReport {
  return {
    overallState: "degraded",
    checkedAt: new Date().toISOString(),
    horizon: { state: "degraded", latencyMs: 2900 },
    sorobanRpc: { state: "ok", latencyMs: 210 },
  };
}

function freshHardDownReport(): DependencyHealthReport {
  return {
    overallState: "hard_down",
    checkedAt: new Date().toISOString(),
    horizon: {
      state: "hard_down",
      latencyMs: 6200,
      message: "ECONNREFUSED",
    },
    sorobanRpc: { state: "ok", latencyMs: 180 },
  };
}

function freshUnavailableReport(): DependencyHealthReport {
  return {
    overallState: "unavailable",
    checkedAt: null,
    horizon: { state: "unknown" },
    sorobanRpc: { state: "unknown" },
  };
}

function freshUnknownReport(): DependencyHealthReport {
  return {
    overallState: "ok",
    checkedAt: new Date().toISOString(),
    horizon: { state: "unknown" },
    sorobanRpc: { state: "ok", latencyMs: 100 },
  };
}

// ── Defaults ──────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseStellarConfig.mockReturnValue(readyTestnetConfig());
  mockUseDependencyHealth.mockReturnValue({
    ...freshHealthyReport(),
    isLoading: false,
    isUnavailable: false,
    error: null,
    lastFetchedAt: Date.now(),
    retry: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Suite ─────────────────────────────────────────────────────────────────

describe("DependencyStatusBanner", () => {
  it("renders the Stellar Testnet network pill on testnet", () => {
    render(<DependencyStatusBanner />);
    expect(screen.getByTestId("network-pill")).toHaveTextContent(
      "Stellar Testnet",
    );
    expect(screen.getByTestId("network-pill")).toHaveAttribute(
      "data-network",
      "testnet",
    );
  });

  it("renders the Stellar Mainnet label on mainnet", () => {
    mockUseStellarConfig.mockReturnValue(readyMainnetConfig());
    render(<DependencyStatusBanner />);
    expect(screen.getByTestId("network-pill")).toHaveTextContent(
      "Stellar Mainnet",
    );
  });

  it("renders the Horizon and Soroban RPC pills with latency values", () => {
    render(<DependencyStatusBanner />);
    expect(screen.getByTestId("horizon-pill")).toHaveTextContent("Horizon");
    expect(screen.getByTestId("horizon-pill")).toHaveAttribute(
      "data-state",
      "ok",
    );
    expect(screen.getByTestId("horizon-pill").textContent).toMatch(/142/);
    expect(screen.getByTestId("soroban-pill")).toHaveTextContent("Soroban RPC");
    expect(screen.getByTestId("soroban-pill")).toHaveAttribute(
      "data-state",
      "ok",
    );
  });

  it("shows the positive 'all dependencies OK' note only when entirely healthy", () => {
    render(<DependencyStatusBanner />);
    expect(screen.getByTestId("dependency-banner-all-ok")).toBeInTheDocument();
  });

  it("surfaces degraded Horizon latency in amber", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshDegradedReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    const horizon = screen.getByTestId("horizon-pill");
    expect(horizon).toHaveAttribute("data-state", "degraded");
    // 2900 ms renders as "2.90 s" — the latency formatter upgrades to
    // seconds at the 1 s threshold.
    expect(horizon.textContent).toMatch(/2\.90\s*s/);
    expect(screen.queryByTestId("dependency-banner-all-ok")).toBeNull();
  });

  it("surfaces a hard_down Horizon with the backend message exposed", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshHardDownReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    const horizon = screen.getByTestId("horizon-pill");
    expect(horizon).toHaveAttribute("data-state", "hard_down");
    expect(horizon).toHaveAttribute("data-message", "ECONNREFUSED");
  });

  it("renders a non-intrusive skeleton strip while the Stellar config is loading", () => {
    mockUseStellarConfig.mockReturnValue(loadingConfig());

    render(<DependencyStatusBanner />);
    const skeleton = screen.getByTestId("dependency-banner-loading");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId("dependency-status-banner")).toBeNull();
  });

  it("renders nothing when the Stellar config has errored (parent already shows a full-page error)", () => {
    mockUseStellarConfig.mockReturnValue(erroredConfig());

    const { container } = render(<DependencyStatusBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a muted 'Status check unavailable' row when the endpoint cannot be reached", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshUnavailableReport(),
      isLoading: false,
      isUnavailable: true,
      error: "fetch failed",
      lastFetchedAt: null,
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    const banner = screen.getByTestId("dependency-status-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByTestId("dependency-banner-unavailable")).toHaveTextContent(
      /Status check unavailable/i,
    );
    expect(screen.queryByTestId("dependency-banner-all-ok")).toBeNull();
  });

  it("exposes a 'Refresh' affordance that triggers the retry callback", async () => {
    const retry = vi.fn();
    mockUseDependencyHealth.mockReturnValue({
      ...freshHealthyReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry,
    });

    render(<DependencyStatusBanner />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("dependency-banner-refresh"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses a custom onRefresh callback in preference to the hook's retry", async () => {
    const onRefresh = vi.fn();
    const retry = vi.fn();
    mockUseDependencyHealth.mockReturnValue({
      ...freshHealthyReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry,
    });

    render(<DependencyStatusBanner onRefresh={onRefresh} />);
    await userEvent.click(screen.getByTestId("dependency-banner-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("omits the Refresh button and shows a spinner while refreshing", async () => {
    let lastFetched = Date.now();
    mockUseDependencyHealth.mockImplementation(() => ({
      ...freshHealthyReport(),
      isLoading: true, // a refresh is in flight
      isUnavailable: false,
      error: null,
      lastFetchedAt: lastFetched,
      retry: vi.fn(),
    }));

    render(<DependencyStatusBanner />);
    expect(screen.queryByTestId("dependency-banner-refresh")).toBeNull();
    expect(screen.getByLabelText(/refreshing dependency status/i)).toBeInTheDocument();
  });

  it("passes the additional className to the outer container", () => {
    render(<DependencyStatusBanner className="extra-class" />);
    expect(screen.getByTestId("dependency-status-banner")).toHaveClass(
      "extra-class",
    );
  });

  it("never reflects unknown dependency states as fully operational", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshUnknownReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    // The Horizon pill must NOT claim 'all operational' when it is unknown.
    expect(screen.queryByTestId("dependency-banner-all-ok")).toBeNull();
  });

  it("does not include any EVM-specific terminology in the rendered text", () => {
    render(<DependencyStatusBanner />);
    const banner = screen.getByTestId("dependency-status-banner");
    expect(banner.textContent).not.toMatch(/gas/i);
    expect(banner.textContent).not.toMatch(/evm/i);
    expect(banner.textContent).not.toMatch(/ethereum/i);
  });

  it("exposes a screen-reader announcement that mirrors the visible state", () => {
    render(<DependencyStatusBanner />);
    expect(screen.getByTestId("dependency-status-banner")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("uses a warning announcement when any dependency is hard_down", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshHardDownReport(),
      isLoading: false,
      isUnavailable: false,
      error: null,
      lastFetchedAt: Date.now(),
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    const banner = screen.getByTestId("dependency-status-banner");
    expect(banner.getAttribute("aria-label")).toMatch(/warning/i);
  });

  it("uses an unavailable announcement when the endpoint is unreachable", () => {
    mockUseDependencyHealth.mockReturnValue({
      ...freshUnavailableReport(),
      isLoading: false,
      isUnavailable: true,
      error: "offline",
      lastFetchedAt: null,
      retry: vi.fn(),
    });

    render(<DependencyStatusBanner />);
    const banner = screen.getByTestId("dependency-status-banner");
    expect(banner.getAttribute("aria-label")).toMatch(
      /dependency status check unavailable/i,
    );
  });
});
