import { Metadata } from "next";
import { notFound } from "next/navigation";
import ProjectDetailClient from "./ProjectDetailClient";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Project ${id} | Lumenpulse`,
    description: "View project details, funding progress, and milestone timeline.",
  };
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;

  // Validate project ID
  const projectId = parseInt(id, 10);
  if (isNaN(projectId) || projectId <= 0) {
    notFound();
  }

  return <ProjectDetailClient projectId={projectId} />;
}