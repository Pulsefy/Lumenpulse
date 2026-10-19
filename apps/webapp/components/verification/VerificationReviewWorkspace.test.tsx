import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerificationReviewWorkspace } from "./VerificationReviewWorkspace";
import type { VerificationRequest } from "@/lib/verification-request-service";

const projectRequest: VerificationRequest = {
  id: "req-project",
  targetType: "PROJECT",
  targetId: "7",
  requesterId: "user-1",
  status: "IN_REVIEW",
  evidence: "Repo: https://github.com/acme/app\nUnsafe: javascript:alert(1)",
  requesterNote: "Please verify before the funding round.",
  reviewerId: null,
  reviewNote: null,
  reviewedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const contributorRequest: VerificationRequest = {
  ...projectRequest,
  id: "req-contributor",
  targetType: "CONTRIBUTOR",
  targetId: "GABC",
  status: "SUBMITTED",
  evidence: "Profile https://example.org/me",
  requesterNote: null,
};

const voteState = {
  projectId: 7,
  name: "Acme",
  ownerPublicKey: "GOWNER",
  status: "PENDING",
  votesFor: 12,
  votesAgainst: 3,
  quorumProgress: 60,
  registeredAt: 0,
  resolvedAt: 0,
};

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function mockBackend(list: VerificationRequest[] = [projectRequest, contributorRequest]) {
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") {
      const id = url.split("/verification-requests/")[1].split("/")[0];
      const body = JSON.parse(String(options.body));
      const current = list.find((r) => r.id === id)!;
      return json(200, {
        ...current,
        status: body.status,
        reviewNote: body.reviewNote ?? null,
        reviewedAt: "2026-10-18T09:00:00.000Z",
      });
    }
    if (url.includes("/verification/projects/7")) return json(200, voteState);
    if (url.includes("/verification-requests")) return json(200, list);
    return json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VerificationReviewWorkspace", () => {
  it.each(["user", null] as const)("is gated for role %s and never calls the API", (role) => {
    const fetchMock = mockBackend();
    render(<VerificationReviewWorkspace role={role} pollIntervalMs={0} />);

    expect(screen.getByText("Reviewer access required")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["reviewer", "admin"] as const)(
    "lists pending requests with evidence and vote state for %s",
    async (role) => {
      mockBackend();
      render(<VerificationReviewWorkspace role={role} pollIntervalMs={0} />);

      const project = await screen.findByRole("article", { name: "PROJECT 7" });
      expect(within(project).getByText("Please verify before the funding round.")).toBeInTheDocument();
      await waitFor(() =>
        expect(within(project).getByTestId("vote-state")).toHaveTextContent(
          "12 for · 3 against · 60% of quorum",
        ),
      );

      const contributor = screen.getByRole("article", { name: "CONTRIBUTOR GABC" });
      expect(within(contributor).getByTestId("vote-state")).toHaveTextContent(
        "Contributor requests have no community vote.",
      );
    },
  );

  it("opens evidence links safely and leaves unsafe URLs as text", async () => {
    mockBackend();
    render(<VerificationReviewWorkspace role="reviewer" pollIntervalMs={0} />);

    const project = await screen.findByRole("article", { name: "PROJECT 7" });
    const link = within(project).getByRole("link", { name: /github\.com\/acme\/app/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/app");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(within(project).queryByRole("link", { name: /javascript/ })).toBeNull();
    expect(within(project).getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
  });

  it("requires a rationale before approving", async () => {
    const fetchMock = mockBackend();
    const user = userEvent.setup();
    render(<VerificationReviewWorkspace role="reviewer" pollIntervalMs={0} />);

    const project = await screen.findByRole("article", { name: "PROJECT 7" });
    await user.click(within(project).getByRole("button", { name: "Approve" }));
    await user.click(within(project).getByRole("button", { name: "Record decision" }));

    expect(within(project).getByRole("alert")).toHaveTextContent("Add a rationale");
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(false);
  });

  it("records a decision and reflects the new state without a reload", async () => {
    const fetchMock = mockBackend();
    const user = userEvent.setup();
    render(<VerificationReviewWorkspace role="reviewer" pollIntervalMs={0} />);

    // Starting review needs no rationale and keeps the request in the pending view.
    const contributor = await screen.findByRole("article", { name: "CONTRIBUTOR GABC" });
    await user.click(within(contributor).getByRole("button", { name: "Record decision" }));
    await waitFor(() =>
      expect(within(contributor).getByTestId("request-status")).toHaveTextContent("In review"),
    );
    expect(within(contributor).getByRole("button", { name: "Approve" })).toBeInTheDocument();

    // Approving with a rationale closes it, so it leaves the pending view.
    const project = screen.getByRole("article", { name: "PROJECT 7" });
    await user.click(within(project).getByRole("button", { name: "Approve" }));
    await user.type(within(project).getByLabelText(/Rationale/), "Repo and docs verified.");
    await user.click(within(project).getByRole("button", { name: "Record decision" }));

    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "PROJECT 7" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("PROJECT 7 is now approved.");

    const patch = fetchMock.mock.calls.filter(([, o]) => o?.method === "PATCH").at(-1)!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      status: "APPROVED",
      reviewNote: "Repo and docs verified.",
    });
    const listCalls = fetchMock.mock.calls.filter(
      ([url, o]) => String(url).includes("/verification-requests") && !o?.method,
    );
    expect(listCalls).toHaveLength(1);
  });

  it("shows the backend error inline when a decision is refused", async () => {
    mockBackend();
    const user = userEvent.setup();
    render(<VerificationReviewWorkspace role="reviewer" pollIntervalMs={0} />);

    const project = await screen.findByRole("article", { name: "PROJECT 7" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(400, { message: "Cannot transition verification request from APPROVED to REJECTED" })),
    );
    await user.click(within(project).getByRole("button", { name: "Reject" }));
    await user.type(within(project).getByLabelText(/Rationale/), "Duplicate.");
    await user.click(within(project).getByRole("button", { name: "Record decision" }));

    expect(await within(project).findByRole("alert")).toHaveTextContent(
      "Cannot transition verification request from APPROVED to REJECTED",
    );
  });

  it("shows the shared error state with a retry when the queue fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(500, { message: "Database unavailable" })));
    render(<VerificationReviewWorkspace role="reviewer" pollIntervalMs={0} />);

    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
