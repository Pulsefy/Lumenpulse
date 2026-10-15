import { describe, it, expect, vi, afterEach } from "vitest";
import { ModerationApiService } from "./moderation-service";

describe("ModerationApiService.submitReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "auth-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  });

  it("posts to /moderation/report and returns the created report on success", async () => {
    const mockReport = {
      id: "abc-123",
      targetType: "project",
      targetId: "42",
      reason: "spam",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockReport,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ModerationApiService.submitReport({
      targetType: "project",
      targetId: "42",
      reason: "spam",
    });

    expect(result).toEqual(mockReport);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/moderation/report"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws a friendly message when the user is unauthenticated (401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    );

    await expect(
      ModerationApiService.submitReport({ targetType: "project", targetId: "1", reason: "spam" })
    ).rejects.toThrow(/log in/i);
  });

  it("surfaces the server error message on a 400 (e.g. duplicate report)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: "You have already reported this content." }),
      })
    );

    await expect(
      ModerationApiService.submitReport({ targetType: "project", targetId: "1", reason: "spam" })
    ).rejects.toThrow("You have already reported this content.");
  });

  it("throws a network error message when fetch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(
      ModerationApiService.submitReport({ targetType: "project", targetId: "1", reason: "spam" })
    ).rejects.toThrow(/network error/i);
  });

  it("includes the auth-token cookie as a Bearer token when present", async () => {
    document.cookie = "auth-token=my-jwt; path=/;";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await ModerationApiService.submitReport({ targetType: "project", targetId: "1", reason: "spam" });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer my-jwt");
  });
});
