import type { Metadata } from "next";
import GrantRoundDetailClient from "./GrantRoundDetailClient";
import type { RoundSummary } from "../components";

import { clientConfig } from '@/lib/config';

const API_BASE = clientConfig.apiUrl;

interface GrantRoundDetailPageProps {
  params: {
    id: string;
  };
}

async function fetchRoundSummary(roundId: string): Promise<RoundSummary | null> {
  try {
    const response = await fetch(`${API_BASE}/grants/rounds/${roundId}/summary`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: GrantRoundDetailPageProps): Promise<Metadata> {
  const summary = await fetchRoundSummary(params.id);

  const title = summary
    ? `Grant Round: ${summary.round.name} - LumenPulse`
    : `Grant Round #${params.id} - LumenPulse`;

  const description = summary
    ? `View details for "${summary.round.name}" — ${summary.projects.length} projects, ${formatPoolDisplay(summary.poolBalance)} XLM matching pool on LumenPulse quadratic funding.`
    : `Explore grant round details, matching pool allocations, and project funding on LumenPulse.`;

  const ogImage = "/assets/lumenpulse-03.png";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://lumenpulse.app/grants/${params.id}`,
      siteName: "LumenPulse",
      images: [{ url: ogImage, width: 71, height: 71, alt: "LumenPulse" }],
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      creator: "@lumenpulse",
    },
  };
}

function formatPoolDisplay(raw: string): string {
  const n = Number(raw) / 1e7;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

export default async function GrantRoundDetailPage({ params }: GrantRoundDetailPageProps) {
  const summary = await fetchRoundSummary(params.id);
  return <GrantRoundDetailClient roundId={params.id} initialData={summary} />;
}
