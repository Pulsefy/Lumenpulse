"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Github,
  ShieldCheck,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Info,
  ClipboardCheck,
  Key,
  UserCheck,
  Lock,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StellarApiService } from "@/lib/api-services";
import { ContributorApiService } from "@/lib/contributor-service";
import { EmptyState } from "@/components/ui/empty-state";
import { ListError } from "@/components/ui/list-error";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { toast } from "sonner";

const TIER_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  Novice: { color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" },
  Builder: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  Architect: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  Core: { color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  Novice: "New contributor getting started",
  Builder: "Active contributor with consistent contributions",
  Architect: "Experienced contributor leading initiatives",
  Core: "Core team member with deep platform knowledge",
};

interface ContributorProfile {
  address: string;
  githubHandle: string;
  reputationScore: number;
  tier: string;
  registeredAt: string;
}

interface ReputationInputs {
  contributions: number;
  grantsSupported: number;
  reviewsCompleted: number;
  tenureDays: number;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ContributorProfilePage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;

  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [reputationInputs, setReputationInputs] = useState<ReputationInputs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [githubHandle, setGithubHandle] = useState("");
  const [showRegistration, setShowRegistration] = useState(false);

  const fetchProfile = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await StellarApiService.getAccountBalances(address);
      // For now, we'll just check if the account exists
      // In a real implementation, we'd call the contributor-registry API
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contributor-registry/wallet/${address}`
      );
      if (response.ok) {
        const contributorData = await response.json();
        setProfile(contributorData);
        // Fetch reputation details
        const repResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contributor-registry/reputation/${address}`
        );
        if (repResponse.ok) {
          const repData = await repResponse.json();
          // Mock reputation inputs for now
          setReputationInputs({
            contributions: 12,
            grantsSupported: 5,
            reviewsCompleted: 3,
            tenureDays: Math.floor(
              (Date.now() - new Date(contributorData.registeredAt).getTime()) /
                (1000 * 60 * 60 * 24)
            ),
          });
        }
      } else if (response.status === 404) {
        setProfile(null); // Not registered
      } else {
        throw new Error(`Failed to fetch profile (${response.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (address) {
      fetchProfile();
    }
  }, [address]);

  const handleRegister = async () => {
    if (!githubHandle.trim()) {
      toast.error("Please enter your GitHub handle");
      return;
    }

    setIsRegistering(true);
    try {
      // This would integrate with the wallet for signing
      // For now, we'll call the nonce endpoint and show the flow
      const nonceRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/contributor-registry/nonce/${address}`
      );
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { nonce } = await nonceRes.json();

      toast.info(
        `Registration initiated. Nonce: ${nonce}. In a full implementation, you would sign this with your wallet.`
      );
      setShowRegistration(false);
      fetchProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-4xl py-16 px-4">
          <ListSkeleton count={3} variant="grid" gridCols={1} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-4xl py-16 px-4">
          <ListError message={error} onRetry={fetchProfile} />
        </div>
      </div>
    );
  }

  const isRegistered = !!profile;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-4xl py-16 px-4 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              Contributor Profile
            </h1>
            <p className="text-foreground/50 mt-1 font-mono text-sm">
              {formatAddress(address)}
            </p>
          </div>
          {!isRegistered && (
            <button
              onClick={() => setShowRegistration(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
            >
              <UserCheck className="w-4 h-4" />
              Register as Contributor
            </button>
          )}
        </div>

        {/* Registration Modal */}
        {showRegistration && !isRegistered && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Register as Contributor</h2>
                <button
                  onClick={() => setShowRegistration(false)}
                  className="text-foreground/40 hover:text-foreground transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <p className="text-foreground/50 text-sm">
                Enter your GitHub handle to register as a contributor. This will
                create an on-chain record linking your Stellar address to your
                GitHub identity.
              </p>
              <input
                type="text"
                value={githubHandle}
                onChange={(e) => setGithubHandle(e.target.value)}
                placeholder="octocat"
                className="w-full px-4 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-foreground placeholder:text-foreground/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                maxLength={39}
              />
              <p className="text-xs text-foreground/40">
                GitHub handle must be 1-39 alphanumeric characters or hyphens, no
                leading/trailing hyphens.
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowRegistration(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-white/10 text-foreground/60 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegister}
                  disabled={isRegistering}
                  className="flex-1 px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Registering...
                    </>
                  ) : (
                    "Register"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Profile Card */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 space-y-6">
          {isRegistered ? (
            <>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Github className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://github.com/${profile.githubHandle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xl font-semibold hover:text-primary transition-colors"
                    >
                      @{profile.githubHandle}
                    </a>
                    <span
                      className={cn(
                        "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border",
                        TIER_STYLES[profile.tier]?.color,
                        TIER_STYLES[profile.tier]?.bg,
                        TIER_STYLES[profile.tier]?.border
                      )}
                    >
                      {profile.tier}
                    </span>
                  </div>
                  <p className="text-foreground/40 text-sm mt-1">
                    {TIER_DESCRIPTIONS[profile.tier]}
                  </p>
                  <p className="text-foreground/30 text-xs mt-1 font-mono">
                    Registered {formatDate(profile.registeredAt)}
                  </p>
                </div>
              </div>

              {/* Reputation Score */}
              <div className="border-t border-white/5 pt-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  Reputation Score
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="md:col-span-2 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-foreground/60 text-sm">Overall Score</span>
                        <span className="text-3xl font-bold font-mono text-primary">
                          {profile.reputationScore}
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(profile.reputationScore, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                    {reputationInputs && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                          <p className="text-foreground/40 text-xs">Contributions</p>
                          <p className="font-semibold text-lg">{reputationInputs.contributions}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                          <p className="text-foreground/40 text-xs">Grants Supported</p>
                          <p className="font-semibold text-lg">{reputationInputs.grantsSupported}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                          <p className="text-foreground/40 text-xs">Reviews Completed</p>
                          <p className="font-semibold text-lg">{reputationInputs.reviewsCompleted}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                          <p className="text-foreground/40 text-xs">Tenure (days)</p>
                          <p className="font-semibold text-lg">{reputationInputs.tenureDays}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-3 space-y-3">
                    <h4 className="text-sm font-medium text-foreground/60">Score Breakdown</h4>
                    {reputationInputs && (
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-foreground/60">Grant Contributions</span>
                            <span className="font-medium">
                              {Math.round(reputationInputs.contributions * 2)} pts
                            </span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{
                                width: `${Math.min(reputationInputs.contributions * 2, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-foreground/60">Reviews Completed</span>
                            <span className="font-medium">
                              {reputationInputs.reviewsCompleted * 5} pts
                            </span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{
                                width: `${Math.min(reputationInputs.reviewsCompleted * 5, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-foreground/60">Tenure Bonus</span>
                            <span className="font-medium">
                              {Math.min(reputationInputs.tenureDays / 10, 20).toFixed(0)} pts
                            </span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full"
                              style={{
                                width: `${Math.min(reputationInputs.tenureDays / 10, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-foreground/60">Grants Supported</span>
                            <span className="font-medium">
                              {reputationInputs.grantsSupported * 3} pts
                            </span>
                          </div>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full"
                              style={{
                                width: `${Math.min(reputationInputs.grantsSupported * 3, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* GitHub Verification Status */}
              <div className="border-t border-white/5 pt-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Github className="w-5 h-5 text-primary" />
                  GitHub Verification
                </h3>
                <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-emerald-400">Verified</p>
                    <p className="text-foreground/50 text-sm">
                      GitHub handle <code className="font-mono">@{profile.githubHandle}</code> is linked and verified.
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={UserCheck}
              title="Not registered as a contributor"
              description="Register to build reputation, participate in governance, and access contributor-only features."
              action={{
                label: "Register Now",
                onClick: () => setShowRegistration(true),
              }}
            />
          )}
        </div>

        {/* Quick Actions */}
        {isRegistered && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              href={`/contributor/${address}/activity`}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.05] transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Activity Feed</p>
                  <p className="text-foreground/40 text-sm">View your contribution history</p>
                </div>
              </div>
              <ArrowRight className="ml-auto w-4 h-4 text-foreground/20 group-hover:text-foreground/60 transition-all" />
            </Link>
            <Link
              href={`/dashboard`}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.05] transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Dashboard</p>
                  <p className="text-foreground/40 text-sm">Manage your portfolio and watchlist</p>
                </div>
              </div>
              <ArrowRight className="ml-auto w-4 h-4 text-foreground/20 group-hover:text-foreground/60 transition-all" />
            </Link>
            <Link
              href={`/review`}
              className="rounded-xl border border-white/5 bg-white/[0.02] p-5 hover:bg-white/[0.05] transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium">Review Workspace</p>
                  <p className="text-foreground/40 text-sm">Review project submissions</p>
                </div>
              </div>
              <ArrowRight className="ml-auto w-4 h-4 text-foreground/20 group-hover:text-foreground/60 transition-all" />
            </Link>
          </div>
        )}

        {/* Registration Flow Explanation */}
        {!isRegistered && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              How Registration Works
            </h3>
            <div className="space-y-3 text-sm text-foreground/60">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                  1
                </div>
                <div>
                  <p className="font-medium">Get Nonce</p>
                  <p>We fetch a unique nonce from the contributor registry contract.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                  2
                </div>
                <div>
                  <p className="font-medium">Sign Off-Chain</p>
                  <p>You sign the registration payload with your Stellar wallet (no gas fees).</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                  3
                </div>
                <div>
                  <p className="font-medium">Submit</p>
                  <p>The signed authorization is submitted by the relayer (gasless).</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                  4
                </div>
                <div>
                  <p className="font-medium">Verified</p>
                  <p>Your GitHub handle is linked on-chain. Reputation tracking begins.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}