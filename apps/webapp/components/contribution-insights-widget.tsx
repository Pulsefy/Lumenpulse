"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trophy, Users, Coins, Info, ArrowRight, Wallet, AlertCircle } from "lucide-react";
import Link from "next/link";

interface ContributionInsightsWidgetProps {
  publicKey: string | null;
}

interface EcosystemMetrics {
  totalContributed: number;
  totalContributors: number;
  totalProjects: number;
  activeRounds: number;
}

interface UserMetrics {
  totalContributed: number;
  transactionsCount: number;
  projectsSupported: number;
}

export default function ContributionInsightsWidget({ publicKey }: ContributionInsightsWidgetProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"ecosystem" | "user">("ecosystem");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [ecosystemMetrics, setEcosystemMetrics] = useState<EcosystemMetrics | null>(null);
  const [userMetrics, setUserMetrics] = useState<UserMetrics | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        // 1. Fetch rounds list
        const roundsRes = await fetch(`${API_BASE}/grants/rounds`);
        if (!roundsRes.ok) throw new Error("Failed to load grant rounds");
        const roundsData = await roundsRes.json();

        // 2. Fetch export details for all rounds to aggregate metrics
        const exports = await Promise.all(
          roundsData.map(async (r: any) => {
            const res = await fetch(`${API_BASE}/grants/rounds/${r.id}/export`);
            if (!res.ok) throw new Error(`Failed to load details for round ${r.id}`);
            return res.json();
          })
        );

        // Aggregate Ecosystem Metrics
        let totalContributedRaw = BigInt(0);
        const uniqueContributors = new Set<string>();
        const uniqueProjects = new Set<number>();
        let activeRounds = 0;

        exports.forEach((exp: any) => {
          if (exp.round.status === "ACTIVE") {
            activeRounds++;
          }
          exp.contributions.forEach((c: any) => {
            totalContributedRaw += BigInt(c.amount);
            uniqueContributors.add(c.contributorPublicKey);
            uniqueProjects.add(c.projectId);
          });
        });

        // Convert 7 decimal points for XLM/Soroban tokens
        const totalContributed = Number(totalContributedRaw) / 10_000_000;

        setEcosystemMetrics({
          totalContributed,
          totalContributors: uniqueContributors.size,
          totalProjects: uniqueProjects.size,
          activeRounds,
        });

        // Calculate User Specific Metrics if publicKey is available
        if (publicKey) {
          let userContributedRaw = BigInt(0);
          let userTxCount = 0;
          const userProjects = new Set<number>();

          exports.forEach((exp: any) => {
            exp.contributions.forEach((c: any) => {
              if (c.contributorPublicKey.toLowerCase() === publicKey.toLowerCase()) {
                userContributedRaw += BigInt(c.amount);
                userTxCount++;
                userProjects.add(c.projectId);
              }
            });
          });

          setUserMetrics({
            totalContributed: Number(userContributedRaw) / 10_000_000,
            transactionsCount: userTxCount,
            projectsSupported: userProjects.size,
          });
        } else {
          setUserMetrics(null);
        }
      } catch (err: any) {
        console.error("Error in ContributionInsightsWidget fetch:", err);
        setError("Failed to fetch contribution metrics.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [publicKey, API_BASE]);

  // Handle active tab fallback when wallet is disconnected
  useEffect(() => {
    if (!publicKey && activeTab === "user") {
      setActiveTab("ecosystem");
    }
  }, [publicKey, activeTab]);

  if (isLoading) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl animate-pulse space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-6 w-48 bg-white/10 rounded"></div>
          <div className="h-4 w-4 bg-white/10 rounded-full"></div>
        </div>
        <div className="flex gap-2 border-b border-white/10 pb-2">
          <div className="h-8 w-24 bg-white/10 rounded-lg"></div>
          <div className="h-8 w-24 bg-white/10 rounded-lg"></div>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-3 bg-white/5 border border-white/5 rounded-lg space-y-2">
              <div className="h-3 w-16 bg-white/10 rounded"></div>
              <div className="h-5 w-24 bg-white/10 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !ecosystemMetrics) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm p-6 rounded-xl border border-white/10 shadow-xl flex flex-col items-center justify-center text-center py-10">
        <AlertCircle className="w-10 h-10 text-rose-500 mb-3" />
        <h3 className="text-lg font-semibold text-white">Metrics Unavailable</h3>
        <p className="text-gray-400 text-sm mt-1 max-w-[280px]">
          {error || "Unable to aggregate data from Stellar Testnet."}
        </p>
      </div>
    );
  }

  const isEmptyState = ecosystemMetrics.totalContributed === 0;

  return (
    <div className="bg-gray-900/50 backdrop-blur-md p-6 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden group">
      {/* Background glow animation */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none transition-all group-hover:bg-cyan-500/10"></div>
      
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-cyan-400" />
          <h2 className="text-xl font-bold tracking-tight text-white font-sans">
            Contribution Insights
          </h2>
        </div>
        
        {/* Tooltip for data source documentation */}
        <div className="relative group/tooltip cursor-pointer">
          <Info size={16} className="text-gray-400 hover:text-white transition-colors" />
          <div className="absolute right-0 bottom-full mb-2 w-64 bg-gray-950/95 border border-white/15 rounded-lg p-3 text-xs text-gray-300 shadow-2xl pointer-events-none opacity-0 translate-y-1 group-hover/tooltip:opacity-100 group-hover/tooltip:translate-y-0 transition-all duration-200 z-30 leading-relaxed font-sans">
            <p className="font-semibold text-cyan-400 mb-1">Data Source</p>
            Real-time aggregate data sourced from LumenPulse Soroban Smart Contracts (Crowdfund Vault) on the Stellar Testnet.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5 mb-5 text-sm font-semibold">
        <button
          onClick={() => setActiveTab("ecosystem")}
          className={`flex-1 py-1.5 rounded-md transition-all ${
            activeTab === "ecosystem"
              ? "bg-cyan-500/25 border border-cyan-500/30 text-cyan-400 shadow"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Ecosystem
        </button>
        <button
          disabled={!publicKey}
          onClick={() => setActiveTab("user")}
          className={`flex-1 py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 ${
            !publicKey
              ? "text-gray-600 cursor-not-allowed"
              : activeTab === "user"
                ? "bg-cyan-500/25 border border-cyan-500/30 text-cyan-400 shadow"
                : "text-gray-400 hover:text-white"
          }`}
        >
          {!publicKey && <Wallet className="w-3.5 h-3.5 text-gray-600" />}
          My Insights
        </button>
      </div>

      {/* Content */}
      {isEmptyState ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Trophy className="w-12 h-12 text-gray-600 mb-3 animate-pulse" />
          <p className="text-gray-400 text-sm font-medium">No contribution activity found on testnet.</p>
          <Link
            href="/grants"
            className="mt-4 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
          >
            Explore Grants <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : activeTab === "ecosystem" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Coins className="w-3.5 h-3.5 text-cyan-400" />
                <span>Total Contributed</span>
              </div>
              <p className="text-lg font-bold text-white font-mono">
                {ecosystemMetrics.totalContributed.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM
              </p>
            </div>
            
            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                <span>Contributors</span>
              </div>
              <p className="text-lg font-bold text-white font-mono">
                {ecosystemMetrics.totalContributors}
              </p>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Trophy className="w-3.5 h-3.5 text-cyan-400" />
                <span>Supported Projects</span>
              </div>
              <p className="text-lg font-bold text-white font-mono">
                {ecosystemMetrics.totalProjects}
              </p>
            </div>

            <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl hover:bg-white/[0.04] transition-all">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Trophy className="w-3.5 h-3.5 text-cyan-400" />
                <span>Active Rounds</span>
              </div>
              <p className="text-lg font-bold text-white font-mono">
                {ecosystemMetrics.activeRounds}
              </p>
            </div>
          </div>

          <div className="pt-2">
            <Link
              href="/grants"
              className="w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
            >
              Participate in SCF Rounds
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        /* My Insights Tab */
        <div className="space-y-4">
          {userMetrics && userMetrics.transactionsCount > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl col-span-1">
                  <p className="text-xs text-gray-400 mb-1">Your Total</p>
                  <p className="text-sm sm:text-base font-bold text-cyan-400 font-mono truncate">
                    {userMetrics.totalContributed.toLocaleString(undefined, { maximumFractionDigits: 1 })} XLM
                  </p>
                </div>
                <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl col-span-1">
                  <p className="text-xs text-gray-400 mb-1">Contribs</p>
                  <p className="text-lg font-bold text-white font-mono">
                    {userMetrics.transactionsCount}
                  </p>
                </div>
                <div className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl col-span-1">
                  <p className="text-xs text-gray-400 mb-1">Projects</p>
                  <p className="text-lg font-bold text-white font-mono">
                    {userMetrics.projectsSupported}
                  </p>
                </div>
              </div>
              
              <div className="p-3.5 bg-cyan-500/5 border border-cyan-500/10 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-cyan-400">Reputation Level: Contributor</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Your testnet contributions shape ecosystem funding match weights!</p>
                </div>
                <Trophy className="w-5 h-5 text-cyan-400 animate-pulse" />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <AlertCircle className="w-10 h-10 text-gray-500 mb-2" />
              <p className="text-gray-400 text-sm font-medium">You haven&apos;t contributed to any projects yet.</p>
              <Link
                href="/grants"
                className="mt-3 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
              >
                Make Your First Contribution <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
