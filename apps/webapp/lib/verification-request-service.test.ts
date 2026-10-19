import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEWER_TRANSITIONS,
  VerificationRequestApiError,
  VerificationRequestApiService,
  requiresRationale,
} from "./verification-request-service";

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "auth-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
});

describe("VerificationRequestApiService.list", () => {
  it("sends the bearer token and the status filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, []));
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "auth-token=reviewer-jwt; path=/;";

    await VerificationRequestApiService.list("IN_REVIEW");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/verification-requests\?status=IN_REVIEW$/);
    expect(options.headers.Authorization).toBe("Bearer reviewer-jwt");
  });

  it("surfaces the backend message on a 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(403, { message: "You do not have permission to access this resource" }),
      ),
    );

    const error = await VerificationRequestApiService.list().catch((e) => e);
    expect(error).toBeInstanceOf(VerificationRequestApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("You do not have permission to access this resource");
  });
});

describe("VerificationRequestApiService.decide", () => {
  it("PATCHes only whitelisted fields with an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { id: "r1", status: "APPROVED" }));
    vi.stubGlobal("fetch", fetchMock);

    await VerificationRequestApiService.decide(
      "r1",
      { status: "APPROVED", reviewNote: "  Evidence checks out.  " },
      "key-1",
    );

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/verification-requests\/r1\/status$/);
    expect(options.method).toBe("PATCH");
    expect(options.headers["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(options.body)).toEqual({ status: "APPROVED", reviewNote: "Evidence checks out." });
  });

  it("omits an empty reviewNote", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { id: "r1", status: "IN_REVIEW" }));
    vi.stubGlobal("fetch", fetchMock);

    await VerificationRequestApiService.decide("r1", { status: "IN_REVIEW", reviewNote: "  " });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: "IN_REVIEW" });
  });

  it("throws the backend's transition error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        respond(400, { message: "Cannot transition verification request from APPROVED to IN_REVIEW" }),
      ),
    );

    await expect(
      VerificationRequestApiService.decide("r1", { status: "IN_REVIEW" }),
    ).rejects.toThrow("Cannot transition verification request from APPROVED to IN_REVIEW");
  });
});

describe("VerificationRequestApiService.getProjectVoteState", () => {
  it("skips the registry for non-numeric targets", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await VerificationRequestApiService.getProjectVoteState("project-slug")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unregistered project", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(404, {})));
    expect(await VerificationRequestApiService.getProjectVoteState("42")).toBeNull();
  });
});

describe("transition rules", () => {
  it("mirror the backend reviewer transitions", () => {
    expect(REVIEWER_TRANSITIONS.SUBMITTED).toEqual(["IN_REVIEW"]);
    expect(REVIEWER_TRANSITIONS.IN_REVIEW).toEqual(["CHANGES_REQUESTED", "APPROVED", "REJECTED"]);
    expect(REVIEWER_TRANSITIONS.APPROVED).toEqual([]);
  });

  it("require a rationale for closing or bouncing decisions only", () => {
    expect(requiresRationale("APPROVED")).toBe(true);
    expect(requiresRationale("REJECTED")).toBe(true);
    expect(requiresRationale("CHANGES_REQUESTED")).toBe(true);
    expect(requiresRationale("IN_REVIEW")).toBe(false);
  });
});
