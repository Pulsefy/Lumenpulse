"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { GrantRound, RoundCard } from "./components";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function GrantsPage() {
  const [rounds, setRounds] = useState<GrantRound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/grants/rounds`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load grant rounds.");
        }
        return response.json();
      })
      .then((data: GrantRound[]) => setRounds(data))
      .catch((err) => setError(err.message || "Failed to load grant rounds."))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <section className="relative pt-32 pb-16 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="container mx-auto max-w-4xl relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-7 h-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Grants</h1>
          </div>
          <p className="text-foreground/50 text-base max-w-xl leading-relaxed">
            Community-funded matching rounds using quadratic funding. More contributors means more
            matching — not just bigger donations.
          </p>
        </div>
      </section>

      <section className="px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-20 text-foreground/40">{error}</div>
          ) : rounds.length === 0 ? (
            <div className="text-center py-20">
              <Trophy className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="text-foreground/40">No grant rounds available yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rounds.map((round) => (
                <RoundCard key={round.id} round={round} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
