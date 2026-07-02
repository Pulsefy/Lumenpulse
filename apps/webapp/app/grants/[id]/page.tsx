"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { RoundDetail, RoundSummary } from "../components";
import { DependencyStatusBanner } from "@/components/DependencyStatusBanner";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface GrantRoundDetailPageProps {
  params: {
    id: string;
  };
}

export default function GrantRoundDetailPage({ params }: GrantRoundDetailPageProps) {
  const [summary, setSummary] = useState<RoundSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSummary() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE}/grants/rounds/${params.id}/summary`);
        if (!response.ok) {
          throw new Error(`Unable to load round details: ${response.statusText}`);
        }
        const data: RoundSummary = await response.json();
        setSummary(data);
      } catch (err: any) {
        console.error(err);
        setError(err?.message ?? "Failed to load round details.");
      } finally {
        setIsLoading(false);
      }
    }

    loadSummary();
  }, [params.id]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-24 pb-8 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center gap-3 mb-6">
            <Users className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Grant Round Detail</h1>
              <p className="text-foreground/50 text-base leading-relaxed">
                View pool balance, allocation ranking, and project-level context for the selected round.
              </p>
            </div>
          </div>

          {/* Network + dependency status banner: re-uses the same component
              as the list view so the experience stays consistent between
              browsing and drilling into a single round. */}
          <div className="mt-2">
            <DependencyStatusBanner />
          </div>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-8 text-center">
              <p className="text-red-400 text-sm mb-4">{error}</p>
              <Link href="/grants" className="inline-flex items-center px-4 py-2 bg-primary text-black rounded-lg font-semibold hover:bg-primary/90 transition">
                Back to grants
              </Link>
            </div>
          ) : summary ? (
            <RoundDetail summary={summary} />
          ) : (
            <div className="text-center py-20 text-foreground/40">
              <p>No round detail available.</p>
              <Link href="/grants" className="mt-4 inline-block text-primary underline">
                Back to grants
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
