import type { Metadata } from "next";
import ContributorProfileClient from "./ContributorProfileClient";

interface PageProps {
  params: { address: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { address } = params;
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return {
    title: `Contributor ${shortAddr} - LumenPulse`,
    description: `Contributor profile, verification status, and recent activity for ${shortAddr} on LumenPulse.`,
  };
}

export default function ContributorProfilePage({ params }: PageProps) {
  return <ContributorProfileClient address={params.address} />;
}
