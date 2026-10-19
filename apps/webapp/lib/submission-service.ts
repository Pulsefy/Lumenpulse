import type { ProjectSubmission, SubmissionActionPayload, SubmissionStatus } from "@/types/submission";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function getAuthHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith("auth-token="));
  const token = match?.split("=")[1];
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const MOCK_SUBMISSIONS: ProjectSubmission[] = [
  {
    projectId: 1,
    creatorPublicKey: "GDEMO1...CREATOR",
    title: "Stellar Smart Contract Auditor",
    content:
      "A comprehensive audit tool for Soroban smart contracts that identifies common vulnerabilities, gas inefficiencies, and logic flaws before deployment. The tool will integrate with CI/CD pipelines and provide automated reports with remediation suggestions.",
    status: "IN_REVIEW",
    reviewerId: "reviewer-alice",
    reviewNote: "Technical architecture looks solid. Waiting for security assessment report.",
    updatedAt: Date.now() / 1000 - 86400,
  },
  {
    projectId: 2,
    creatorPublicKey: "GDEMO2...CREATOR",
    title: "Community Treasury Dashboard",
    content:
      "A real-time dashboard for the Lumenpulse community treasury showing fund allocations, upcoming disbursements, and historical spending patterns. Built with Next.js and connected to Stellar Horizon API for on-chain transparency.",
    status: "CHANGES_REQUESTED",
    reviewerId: "reviewer-bob",
    reviewNote:
      "Please add a section for quarterly budget forecasts and clarify the data refresh interval.",
    updatedAt: Date.now() / 1000 - 172800,
  },
  {
    projectId: 3,
    creatorPublicKey: "GDEMO3...CREATOR",
    title: "Decentralized Identity Verification",
    content:
      "A self-sovereign identity verification system built on Stellar that allows users to prove attributes (age, residency, credentials) without revealing underlying data. Uses zero-knowledge proofs and Verifiable Credentials.",
    status: "DRAFT",
    updatedAt: Date.now() / 1000 - 3600,
  },
  {
    projectId: 4,
    creatorPublicKey: "GDEMO4...CREATOR",
    title: "Micro-grants Distribution Protocol",
    content:
      "A protocol for distributing micro-grants to open source contributors based on measurable impact metrics. Contributors earn reputation scores through verifiable contributions, and grants are distributed automatically via Soroban contracts.",
    status: "APPROVED",
    reviewerId: "reviewer-alice",
    reviewNote: "Approved with minor edits. Ready for publishing.",
    updatedAt: Date.now() / 1000 - 432000,
  },
  {
    projectId: 5,
    creatorPublicKey: "GDEMO5...CREATOR",
    title: "Cross-chain Bridge Analytics",
    content:
      "Analytics platform tracking cross-chain bridge activity between Stellar and EVM chains. Monitors liquidity flows, detects suspicious bridging patterns, and provides risk scores for bridge routes.",
    status: "PUBLISHED",
    reviewerId: "reviewer-bob",
    reviewNote: "Published after final review.",
    updatedAt: Date.now() / 1000 - 604800,
  },
];

let mockSubmissions = [...MOCK_SUBMISSIONS];

export class SubmissionApiService {
  static async listSubmissions(
    status?: SubmissionStatus,
  ): Promise<ProjectSubmission[]> {
    const params = status ? `?status=${status}` : "";
    const response = await fetch(`${API_BASE}/verification/submissions${params}`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch submissions: ${response.status}`);
    }

    const data: ProjectSubmission[] = await response.json();
    return data.length > 0 ? data : mockSubmissions;
  }

  static async getSubmission(projectId: number): Promise<ProjectSubmission> {
    const response = await fetch(
      `${API_BASE}/verification/submissions/${projectId}`,
      {
        headers: getAuthHeaders(),
      }
    );

    if (response.ok) {
      return response.json();
    }

    const mock = mockSubmissions.find((s) => s.projectId === projectId);
    if (mock) return mock;

    throw new Error(`Submission ${projectId} not found`);
  }

  static async requestChanges(
    projectId: number,
    payload: SubmissionActionPayload,
  ): Promise<ProjectSubmission> {
    const response = await fetch(
      `${API_BASE}/verification/submissions/${projectId}/request-changes`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Failed to request changes: ${response.status}`);
    }

    return response.json();
  }

  static async approve(
    projectId: number,
    payload: SubmissionActionPayload,
  ): Promise<ProjectSubmission> {
    const response = await fetch(
      `${API_BASE}/verification/submissions/${projectId}/approve`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Failed to approve: ${response.status}`);
    }

    return response.json();
  }

  static async publish(
    projectId: number,
    payload: SubmissionActionPayload,
  ): Promise<ProjectSubmission> {
    const response = await fetch(
      `${API_BASE}/verification/submissions/${projectId}/publish`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Failed to publish: ${response.status}`);
    }

    return response.json();
  }

  static async submitForReview(projectId: number): Promise<ProjectSubmission> {
    const response = await fetch(
      `${API_BASE}/verification/submissions/${projectId}/submit`,
      {
        method: "POST",
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `Failed to submit for review: ${response.status}`);
    }

    return response.json();
  }
}
