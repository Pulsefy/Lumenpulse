import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWalletReadiness, validateAmount } from "@/hooks/useWalletReadiness";
import { useStellarWallet } from "@/app/providers";
import { useStellarConfig } from "@/contexts/StellarConfigContext";

vi.mock("@/app/providers", () => ({
  useStellarWallet: vi.fn(),
}));

vi.mock("@/contexts/StellarConfigContext", () => ({
  useStellarConfig: vi.fn(),
}));

const mockWallet = (
  overrides: Partial<ReturnType<typeof useStellarWallet>>,
) => {
  vi.mocked(useStellarWallet).mockReturnValue({
    publicKey: null,
    status: "disconnected",
    ...overrides,
  } as any);
};

const mockConfig = (
  overrides: Partial<ReturnType<typeof useStellarConfig>>,
) => {
  vi.mocked(useStellarConfig).mockReturnValue({
    config: null,
    status: "loading",
    error: null,
    retry: () => {},
    ...overrides,
  } as any);
};

const validConfig = {
  network: "testnet",
  contracts: { crowdfundVault: "CABC123" },
} as any;

describe("validateAmount", () => {
  it("returns null for null / undefined / empty inputs", () => {
    expect(validateAmount(null)).toBeNull();
    expect(validateAmount(undefined as any)).toBeNull();
    expect(validateAmount("")).toBeNull();
    expect(validateAmount("   ")).toBeNull();
  });

  it("returns null for positive numeric strings", () => {
    expect(validateAmount("10")).toBeNull();
    expect(validateAmount("0.5")).toBeNull();
    expect(validateAmount("  42  ")).toBeNull();
  });

  it("returns a blocking issue for zero, negative, or non-numeric input", () => {
    const zero = validateAmount("0");
    expect(zero?.reason).toBe("amount_invalid");
    expect(zero?.blocking).toBe(true);

    const negative = validateAmount("-3");
    expect(negative?.reason).toBe("amount_invalid");

    const nan = validateAmount("abc");
    expect(nan?.reason).toBe("amount_invalid");
  });
});

describe("useWalletReadiness", () => {
  it("is ready when the wallet is connected and the config is valid", () => {
    mockWallet({ publicKey: "GABC", status: "connected" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness({ amount: "10" }));
    expect(result.current.ready).toBe(true);
    expect(result.current.issues).toHaveLength(0);
    expect(result.current.blocker).toBeNull();
  });

  it("reports wallet_disconnected when no public key is available", () => {
    mockWallet({ publicKey: null, status: "disconnected" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.ready).toBe(false);
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "wallet_disconnected",
    );
  });

  it("reports wallet_missing_extension when Freighter is not installed", () => {
    mockWallet({ publicKey: null, status: "missing_extension" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "wallet_missing_extension",
    );
    expect(result.current.blocker?.reason).toBe("wallet_missing_extension");
  });

  it("reports wallet_rejected when the user previously declined the connection", () => {
    mockWallet({ publicKey: null, status: "rejected" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "wallet_rejected",
    );
  });

  it("reports wallet_connecting as blocking when a connection is in flight", () => {
    mockWallet({ publicKey: null, status: "connecting" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "wallet_connecting",
    );
    expect(result.current.ready).toBe(false);
  });

  it("reports config_loading when the runtime config has not resolved", () => {
    mockWallet({ publicKey: "GABC", status: "connected" });
    mockConfig({ config: null, status: "loading" });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "config_loading",
    );
  });

  it("reports config_error when the runtime config fetch failed", () => {
    mockWallet({ publicKey: "GABC", status: "connected" });
    mockConfig({
      config: null,
      status: "error",
      error: "500",
    });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "config_error",
    );
  });

  it("reports vault_contract_missing when the config lacks the vault id", () => {
    mockWallet({ publicKey: "GABC", status: "connected" });
    mockConfig({
      config: { network: "testnet", contracts: {} },
      status: "ready",
    });

    const { result } = renderHook(() => useWalletReadiness());
    expect(result.current.issues.map((i) => i.reason)).toContain(
      "vault_contract_missing",
    );
  });

  it("aggregates multiple issues when wallet and config are both broken", () => {
    mockWallet({ publicKey: null, status: "disconnected" });
    mockConfig({ config: null, status: "loading" });

    const { result } = renderHook(() => useWalletReadiness({ amount: "0" }));
    const reasons = result.current.issues.map((i) => i.reason);
    expect(reasons).toContain("wallet_disconnected");
    expect(reasons).toContain("config_loading");
    expect(reasons).toContain("amount_invalid");
    expect(result.current.blocker).not.toBeNull();
  });

  it("skips the amount check when amount is null", () => {
    mockWallet({ publicKey: "GABC", status: "connected" });
    mockConfig({ config: validConfig, status: "ready" });

    const { result } = renderHook(() => useWalletReadiness({ amount: null }));
    expect(result.current.issues.map((i) => i.reason)).not.toContain(
      "amount_invalid",
    );
    expect(result.current.ready).toBe(true);
  });
});
