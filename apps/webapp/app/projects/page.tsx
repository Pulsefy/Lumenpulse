import { Metadata } from "next";
import ProjectsPageClient from "./ProjectsPageClient";

export const metadata: Metadata = {
  title: "Projects | Lumenpulse",
  description: "Browse and contribute to community-funded projects.",
};

export default function ProjectsPage() {
  return <ProjectsPageClient />;
}