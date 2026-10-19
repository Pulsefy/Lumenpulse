import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}));

import * as freighter from "@stellar/freighter-api";
import { FreighterWalletAdapter } from "./adapters/freighter-adapter";
import { XBullWalletAdapter } from "./adapters/xbull-adapter";
import {
  createWalletAdapterRegistry,
  findWalletAdapter,
  getAvailableWalletAdapters,
  getDefaultWalletAdapter,
} from "./registry";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win.freighter;
  delete win.xBullSDK;
  vi.clearAllMocks();
});

describe("wallet registry", () => {
  it("lists Freighter first, then xBull", () => {
    expect(createWalletAdapterRegistry().map((a) => a.id)).toEqual(["freighter", "xbull"]);
  });

  it("only reports installed wallets as available", async () => {
    expect(await getAvailableWalletAdapters()).toEqual([]);

    win.xBullSDK = {};
    expect((await getAvailableWalletAdapters()).map((a) => a.id)).toEqual(["xbull"]);

    win.freighter = true;
    expect((await getAvailableWalletAdapters()).map((a) => a.id)).toEqual(["freighter", "xbull"]);
  });

  it("falls back to Freighter as default when nothing is installed", async () => {
    expect((await getDefaultWalletAdapter()).id).toBe("freighter");
  });

  it("finds adapters by id", () => {
    expect(findWalletAdapter("xbull")?.name).toBe("xBull");
    expect(findWalletAdapter("nope")).toBeUndefined();
    expect(findWalletAdapter(null)).toBeUndefined();
  });
});

describe("FreighterWalletAdapter", () => {
  beforeEach(() => {
    win.freighter = true;
  });

  it("reports missing_wallet when the extension is absent", async () => {
    delete win.freighter;
    const result = await new FreighterWalletAdapter().connect();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("missing_wallet");
  });

  it("connects and returns the address", async () => {
    vi.mocked(freighter.requestAccess).mockResolvedValue({ address: "GABC" } as any);
    const result = await new FreighterWalletAdapter().connect();
    expect(result).toEqual({ status: "connected", pubkey: "GABC" });
  });

  it("maps a user-declined request to rejected", async () => {
    vi.mocked(freighter.requestAccess).mockResolvedValue({
      address: "",
      error: "User declined access",
    } as any);
    const result = await new FreighterWalletAdapter().connect();
    expect(result.status).toBe("rejected");
  });

  it("passes the network passphrase through and returns the signed XDR", async () => {
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: "SIGNED",
      signerAddress: "GABC",
    } as any);
    const result = await new FreighterWalletAdapter().signXdr("UNSIGNED", {
      networkPassphrase: "Test SDF Network ; September 2015",
      address: "GABC",
    });
    expect(freighter.signTransaction).toHaveBeenCalledWith("UNSIGNED", {
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(result).toEqual({ status: "success", signedXdr: "SIGNED" });
  });

  it("surfaces signing errors as a message", async () => {
    vi.mocked(freighter.signTransaction).mockResolvedValue({
      signedTxXdr: "",
      error: { code: -1, message: "Transaction malformed" },
    } as any);
    const result = await new FreighterWalletAdapter().signXdr("UNSIGNED");
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("Transaction malformed");
  });

  it("restores an existing session without prompting", async () => {
    vi.mocked(freighter.isConnected).mockResolvedValue({ isConnected: true } as any);
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: "GABC" } as any);
    expect(await new FreighterWalletAdapter().getConnectedAddress()).toBe("GABC");
    expect(freighter.requestAccess).not.toHaveBeenCalled();
  });
});

describe("XBullWalletAdapter", () => {
  it("connects via the injected SDK", async () => {
    win.xBullSDK = {
      connect: vi.fn().mockResolvedValue(true),
      getPublicKey: vi.fn().mockResolvedValue("GXBULL"),
      signXDR: vi.fn(),
    };
    const result = await new XBullWalletAdapter().connect();
    expect(result).toEqual({ status: "connected", pubkey: "GXBULL" });
  });

  it("signs with network and public key", async () => {
    const signXDR = vi.fn().mockResolvedValue("SIGNED");
    win.xBullSDK = { connect: vi.fn(), getPublicKey: vi.fn(), signXDR };
    const result = await new XBullWalletAdapter().signXdr("UNSIGNED", {
      networkPassphrase: "PASS",
      address: "GXBULL",
    });
    expect(signXDR).toHaveBeenCalledWith("UNSIGNED", { network: "PASS", publicKey: "GXBULL" });
    expect(result).toEqual({ status: "success", signedXdr: "SIGNED" });
  });

  it("maps a thrown rejection to rejected", async () => {
    win.xBullSDK = {
      connect: vi.fn(),
      getPublicKey: vi.fn(),
      signXDR: vi.fn().mockRejectedValue(new Error("User rejected the request")),
    };
    const result = await new XBullWalletAdapter().signXdr("UNSIGNED");
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("rejected");
  });

  it("reports missing_wallet when the SDK is absent", async () => {
    const result = await new XBullWalletAdapter().signXdr("UNSIGNED");
    expect(result.error?.code).toBe("missing_wallet");
  });
});
