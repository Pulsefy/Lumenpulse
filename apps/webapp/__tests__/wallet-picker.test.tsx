import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

import { StellarProvider, useStellarWallet } from "@/app/providers";
import type { WalletAdapter } from "@/lib/wallet";

function fakeAdapter(id: string, name: string, available = true): WalletAdapter {
  return {
    id,
    name,
    isAvailable: () => available,
    connect: vi.fn().mockResolvedValue({ status: "connected", pubkey: `G_${id.toUpperCase()}` }),
    signXdr: vi.fn().mockResolvedValue({ status: "success", signedXdr: `SIGNED_BY_${id}` }),
  };
}

function Probe() {
  const { publicKey, walletId, status, error, connect, signXdr } = useStellarWallet();
  return (
    <div>
      <span data-testid="pk">{publicKey ?? ""}</span>
      <span data-testid="wallet">{walletId ?? ""}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button onClick={() => connect()}>connect</button>
      <button
        onClick={async () => {
          const r = await signXdr("XDR");
          document.body.setAttribute("data-signed", r.signedXdr ?? "");
        }}
      >
        sign
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.body.removeAttribute("data-signed");
});

describe("StellarProvider wallet selection", () => {
  it("connects directly when only one wallet is installed (no picker)", async () => {
    const freighter = fakeAdapter("freighter", "Freighter");
    const xbull = fakeAdapter("xbull", "xBull", false);
    render(
      <StellarProvider adapters={[freighter, xbull]}>
        <Probe />
      </StellarProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    await waitFor(() => expect(screen.getByTestId("pk").textContent).toBe("G_FREIGHTER"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(freighter.connect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("lumenpulse_wallet_adapter")).toBe("freighter");
  });

  it("shows a picker when several wallets are installed and routes signing to the choice", async () => {
    const freighter = fakeAdapter("freighter", "Freighter");
    const xbull = fakeAdapter("xbull", "xBull");
    render(
      <StellarProvider adapters={[freighter, xbull]}>
        <Probe />
      </StellarProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Freighter");
    expect(dialog.textContent).toContain("xBull");

    await act(async () => {
      fireEvent.click(screen.getByText("xBull"));
    });

    await waitFor(() => expect(screen.getByTestId("wallet").textContent).toBe("xbull"));
    expect(freighter.connect).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByText("sign"));
    });
    await waitFor(() => expect(document.body.getAttribute("data-signed")).toBe("SIGNED_BY_xbull"));
    expect(xbull.signXdr).toHaveBeenCalledWith("XDR", { address: "G_XBULL" });
  });

  it("reports missing_extension when no wallet is installed", async () => {
    render(
      <StellarProvider adapters={[fakeAdapter("freighter", "Freighter", false)]}>
        <Probe />
      </StellarProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("missing_extension"));
    expect(screen.getByTestId("error").textContent).toContain("Freighter");
  });

  it("closing the picker leaves the wallet disconnected", async () => {
    render(
      <StellarProvider adapters={[fakeAdapter("freighter", "Freighter"), fakeAdapter("xbull", "xBull")]}>
        <Probe />
      </StellarProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });
    await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Close wallet picker"));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
  });
});
