import { render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContributorProfileClient from "./ContributorProfileClient";

const TEST_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Mock the ContributorApiService
vi.mock("@/lib/contributor-service", () => ({
  ContributorApiService: {
    getProfile: vi.fn(),
  },
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => {
    const { default: _, ...rest } = props as Record<string, unknown>;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

import { ContributorApiService } from "@/lib/contributor-service";

const mockedGetProfile = vi.mocked(ContributorApiService.getProfile);

describe("ContributorProfileClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("shows loading state initially", () => {
    // Never resolves → stays in loading
    mockedGetProfile.mockReturnValue(new Promise(() => {}));

    render(<ContributorProfileClient address={TEST_ADDRESS} />);

    // Loading skeleton should be present (animated pulse divs)
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows not-found state when profile fetch fails", async () => {
    mockedGetProfile.mockRejectedValue(new Error("Not found"));

    render(<ContributorProfileClient address={TEST_ADDRESS} />);

    await waitFor(() => {
      expect(screen.getByText("Contributor Not Found")).toBeInTheDocument();
    });
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("renders contributor profile with stats and activity", async () => {
    mockedGetProfile.mockResolvedValue({
      address: TEST_ADDRESS,
      activities: [
        {
          id: "act-1",
          activityType: "grant_contribution",
          contributorAddress: TEST_ADDRESS,
          timestamp: "2026-07-01T12:00:00.000Z",
          summary: "Contributed 50 XLM to Project Alpha",
        },
        {
          id: "act-2",
          activityType: "contributor_registered",
          contributorAddress: TEST_ADDRESS,
          timestamp: "2026-06-15T08:00:00.000Z",
          summary: "Contributor registered on testnet",
          githubHandle: "octocat",
        },
      ],
      totalActivities: 2,
      isSparseContributor: false,
      aggregates: {
        totalContributed: 125.5,
        transactionsCount: 5,
        projectsSupported: 3,
      },
    });

    render(<ContributorProfileClient address={TEST_ADDRESS} />);

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.getByText("Contributor Profile")).toBeInTheDocument();
    });

    // Check stats
    expect(screen.getByText(/125.5/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // Check activity items
    expect(
      screen.getByText("Contributed 50 XLM to Project Alpha"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Contributor registered on testnet"),
    ).toBeInTheDocument();
    expect(screen.getByText("GitHub: @octocat")).toBeInTheDocument();

    // Check verification status
    expect(screen.getByText("Active & Verified")).toBeInTheDocument();
  });

  it("shows sparse/new contributor status for first-time contributors", async () => {
    mockedGetProfile.mockResolvedValue({
      address: TEST_ADDRESS,
      activities: [
        {
          id: "act-1",
          activityType: "contributor_registered",
          contributorAddress: TEST_ADDRESS,
          timestamp: "2026-07-20T10:00:00.000Z",
          summary: "Contributor registered on testnet",
        },
      ],
      totalActivities: 1,
      isSparseContributor: true,
      aggregates: {
        totalContributed: 0,
        transactionsCount: 0,
        projectsSupported: 0,
      },
    });

    render(<ContributorProfileClient address={TEST_ADDRESS} />);

    await waitFor(() => {
      expect(screen.getByText("New Contributor")).toBeInTheDocument();
    });

    expect(screen.getByText("Pending Review")).toBeInTheDocument();
  });

  it("shows empty activity state when no activities exist", async () => {
    mockedGetProfile.mockResolvedValue({
      address: TEST_ADDRESS,
      activities: [],
      totalActivities: 0,
      isSparseContributor: true,
      aggregates: {
        totalContributed: 0,
        transactionsCount: 0,
        projectsSupported: 0,
      },
    });

    render(<ContributorProfileClient address={TEST_ADDRESS} />);

    await waitFor(() => {
      expect(screen.getByText("No activity recorded yet")).toBeInTheDocument();
    });
  });

  it("copies address to clipboard when copy button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    mockedGetProfile.mockResolvedValue({
      address: TEST_ADDRESS,
      activities: [],
      totalActivities: 0,
      isSparseContributor: true,
      aggregates: {
        totalContributed: 0,
        transactionsCount: 0,
        projectsSupported: 0,
      },
    });

    await act(async () => {
      render(<ContributorProfileClient address={TEST_ADDRESS} />);
    });

    await waitFor(() => {
      expect(screen.getByText("Contributor Profile")).toBeInTheDocument();
    });

    const copyBtn = screen.getByLabelText("Copy address");
    await act(async () => {
      await copyBtn.click();
    });

    expect(writeText).toHaveBeenCalledWith(TEST_ADDRESS);
  });
});
