import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FeatureFlagsApiService,
  SensitiveConfirmationRequiredError,
  describeAuditEntry,
  describeTargeting,
  type FeatureFlag,
  type FlagAuditEntry,
} from "./feature-flags-service";

const flag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  key: "new-onboarding",
  enabled: true,
  sensitive: false,
  rolloutPercentage: null,
  allowList: ["qa-1"],
  denyList: ["banned-1"],
  conditions: { roles: ["ADMIN"] },
  changedBy: "admin@test.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

const okFetch = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("FeatureFlagsApiService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "auth-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  });

  it("sends the bearer token when listing flags", async () => {
    document.cookie = "auth-token=abc.def.ghi; path=/";
    const fetchMock = okFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await FeatureFlagsApiService.listFlags();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/feature-flags$/),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer abc.def.ghi" }),
      }),
    );
  });

  it("encodes the key when fetching history", async () => {
    const fetchMock = okFetch([]);
    vi.stubGlobal("fetch", fetchMock);

    await FeatureFlagsApiService.getHistory("a/b");

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/feature-flags\/a%2Fb\/history$/);
  });

  it("a toggle sends only on/off plus conditions, leaving targeting untouched", async () => {
    const fetchMock = okFetch(flag({ enabled: false }));
    vi.stubGlobal("fetch", fetchMock);

    await FeatureFlagsApiService.updateFlag(flag(), { enabled: false });

    expect(sentBody(fetchMock)).toEqual({
      key: "new-onboarding",
      enabled: false,
      conditions: { roles: ["ADMIN"] },
    });
  });

  it("a rollout change echoes the existing allow/deny lists so they are not wiped", async () => {
    const fetchMock = okFetch(flag({ rolloutPercentage: 25 }));
    vi.stubGlobal("fetch", fetchMock);

    await FeatureFlagsApiService.updateFlag(flag(), { rolloutPercentage: 25 });

    expect(sentBody(fetchMock)).toMatchObject({
      enabled: true,
      rolloutPercentage: 25,
      allowList: ["qa-1"],
      denyList: ["banned-1"],
    });
  });

  it("clears a rollout by sending null and passes confirm when asked", async () => {
    const fetchMock = okFetch(flag());
    vi.stubGlobal("fetch", fetchMock);

    await FeatureFlagsApiService.updateFlag(
      flag({ rolloutPercentage: 10, sensitive: true }),
      { rolloutPercentage: null },
      { confirm: true },
    );

    expect(sentBody(fetchMock)).toMatchObject({ rolloutPercentage: null, confirm: true });
  });

  it("maps 428 to SensitiveConfirmationRequiredError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 428,
        json: async () => ({ message: "needs confirm" }),
      }),
    );

    await expect(
      FeatureFlagsApiService.updateFlag(flag(), { enabled: false }),
    ).rejects.toBeInstanceOf(SensitiveConfirmationRequiredError);
  });

  it("explains a 403 as missing admin access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
    );

    await expect(FeatureFlagsApiService.listFlags()).rejects.toThrow(/admin access/i);
  });
});

describe("describeTargeting", () => {
  it("describes plain on/off", () => {
    expect(describeTargeting(flag({ allowList: null, denyList: null }))).toBe(
      "On for everyone",
    );
  });

  it("describes a percentage rollout with list counts", () => {
    expect(describeTargeting(flag({ rolloutPercentage: 5 }))).toBe(
      "Rollout 5% of users · 1 allowed · 1 denied",
    );
  });

  it("calls out 0% as serving nobody even when enabled", () => {
    expect(
      describeTargeting(flag({ rolloutPercentage: 0, allowList: null, denyList: null })),
    ).toBe("Rollout 0% (serves nobody)");
  });
});

describe("describeAuditEntry", () => {
  const entry = (overrides: Partial<FlagAuditEntry>): FlagAuditEntry => ({
    id: "1",
    flagKey: "k",
    action: "upsert",
    previousEnabled: false,
    newEnabled: false,
    previousTargeting: { rolloutPercentage: null, allowList: [], denyList: [] },
    newTargeting: { rolloutPercentage: null, allowList: [], denyList: [] },
    actor: "admin",
    changedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  it("summarises toggles and rollout changes together", () => {
    expect(
      describeAuditEntry(
        entry({
          newEnabled: true,
          newTargeting: { rolloutPercentage: 20, allowList: [], denyList: [] },
        }),
      ),
    ).toBe("off → on, rollout none → 20%");
  });

  it("labels creations and deletions", () => {
    expect(
      describeAuditEntry(entry({ previousEnabled: null, previousTargeting: null, newEnabled: true })),
    ).toBe("Created (on)");
    expect(describeAuditEntry(entry({ action: "remove" }))).toBe("Deleted flag");
  });
});
