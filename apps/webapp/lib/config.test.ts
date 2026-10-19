import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("clientConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("exports apiUrl from NEXT_PUBLIC_API_URL with fallback", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const { clientConfig } = await import("./config");
    expect(clientConfig.apiUrl).toBe("http://localhost:3001");
  });

  it("uses NEXT_PUBLIC_API_URL when set", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    const { clientConfig } = await import("./config");
    expect(clientConfig.apiUrl).toBe("https://api.example.com");
  });

  it("exports stellarExplorerUrl from NEXT_PUBLIC_STELLAR_EXPLORER_URL with fallback", async () => {
    delete process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL;
    const { clientConfig } = await import("./config");
    expect(clientConfig.stellarExplorerUrl).toBe(
      "https://stellar.expert/explorer"
    );
  });

  it("uses NEXT_PUBLIC_STELLAR_EXPLORER_URL when set", async () => {
    process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL =
      "https://steexp.com/explorer";
    const { clientConfig } = await import("./config");
    expect(clientConfig.stellarExplorerUrl).toBe(
      "https://steexp.com/explorer"
    );
  });
});

describe("serverConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses fallback when BACKEND_API_URL is missing", async () => {
    delete process.env.BACKEND_API_URL;
    const { serverConfig } = await import("./config");
    expect(serverConfig.backendApiUrl).toBe("http://localhost:3001");
  });

  it("returns the value when BACKEND_API_URL is set", async () => {
    process.env.BACKEND_API_URL = "https://backend.example.com";
    const { serverConfig } = await import("./config");
    expect(serverConfig.backendApiUrl).toBe("https://backend.example.com");
  });
});
