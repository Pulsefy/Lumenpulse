import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projects | Lumenpulse",
  description: "Browse and contribute to community-funded projects.",
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}